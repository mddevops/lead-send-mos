<?php

namespace App\Filament\Resources\Sites\Tables;

use App\Filament\Resources\Sites\Pages\ManualSiteMapping;
use App\Models\BotTask;
use App\Models\Campaign;
use App\Models\CampaignSiteRun;
use App\Models\ProjectSetting;
use App\Models\Site;
use App\Services\DailyPipelineService;
use App\Services\LeadIdentityGenerator;
use App\Support\DataSyncFilamentActions;
use App\Support\ProxyPicker;
use App\Support\SubmitLeadPayloadBuilder;
use Filament\Actions\Action;
use Filament\Actions\BulkAction;
use Filament\Actions\BulkActionGroup;
use Filament\Actions\DeleteBulkAction;
use Filament\Actions\EditAction;
use Filament\Forms\Components\DateTimePicker;
use Filament\Forms\Components\Radio;
use Filament\Notifications\Notification;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Auth;
use Throwable;

class SitesTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('name')
                    ->label('Название')
                    ->searchable(),
                TextColumn::make('region.name')
                    ->label('Регион')
                    ->searchable(),
                TextColumn::make('url')
                    ->label('URL')
                    ->searchable(),
                TextColumn::make('ad_url')
                    ->label('Рекламная ссылка')
                    ->limit(40)
                    ->tooltip(fn (?string $state): ?string => $state)
                    ->toggleable(isToggledHiddenByDefault: true)
                    ->wrap(),
                IconColumn::make('is_promo')
                    ->label('Промо')
                    ->boolean()
                    ->trueIcon('heroicon-o-megaphone')
                    ->falseIcon('heroicon-o-document-text')
                    ->trueColor('warning')
                    ->falseColor('gray')
                    ->sortable(),
                TextColumn::make('address')
                    ->label('Адрес')
                    ->searchable()
                    ->toggleable(isToggledHiddenByDefault: true)
                    ->wrap(),
                TextColumn::make('phone')
                    ->label('Телефон')
                    ->searchable()
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('business_status')
                    ->label('Организация')
                    ->badge()
                    ->formatStateUsing(fn (?string $state): string => match ($state) {
                        'open' => 'Открыто',
                        'closed' => 'Закрыто',
                        default => $state ?? '—',
                    })
                    ->color(fn (?string $state): string => match ($state) {
                        'open' => 'success',
                        'closed' => 'danger',
                        default => 'gray',
                    })
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('rating_count')
                    ->label('Количество отзывов')
                    ->numeric()
                    ->sortable()
                    ->placeholder('—'),
                TextColumn::make('rating_value')
                    ->label('Рейтинг')
                    ->formatStateUsing(fn ($state): string => $state === null ? '—' : number_format((float) $state, 1))
                    ->sortable()
                    ->placeholder('—'),
                TextColumn::make('status')
                    ->label('Статус')
                    ->badge()
                    ->formatStateUsing(fn (string $state): string => match ($state) {
                        'new' => 'Новый',
                        'scanning' => 'Сканирование',
                        'ready' => 'Готов',
                        'needs_manual_mapping' => 'Нужна ручная настройка',
                        'mapping_failed' => 'Ошибка маппинга',
                        'disabled' => 'Отключён',
                        default => $state,
                    }),
                TextColumn::make('submit_heal_status')
                    ->label('Автолечение')
                    ->badge()
                    ->placeholder('—')
                    ->formatStateUsing(fn (?string $state): string => match ($state) {
                        'paused_remap' => 'Пауза (ошибки)',
                        'rescanning' => 'Рескан формы',
                        'testing' => 'Тест новой формы',
                        'failed_heal' => 'Лечение не удалось',
                        default => $state ? (string) $state : '—',
                    })
                    ->color(fn (?string $state): string => match ($state) {
                        'testing', 'rescanning' => 'warning',
                        'paused_remap' => 'danger',
                        'failed_heal' => 'gray',
                        default => 'gray',
                    })
                    ->toggleable(),
                TextColumn::make('submit_fail_streak')
                    ->label('Ошибки подряд')
                    ->alignRight()
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('last_scan_at')
                    ->label('Последнее сканирование')
                    ->dateTime()
                    ->sortable(),
                TextColumn::make('created_at')
                    ->label('Создано')
                    ->dateTime()
                    ->sortable()
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('updated_at')
                    ->label('Обновлено')
                    ->dateTime()
                    ->sortable()
                    ->toggleable(isToggledHiddenByDefault: true),
            ])
            ->filters([
                SelectFilter::make('region_id')
                    ->label('Регион')
                    ->relationship('region', 'name')
                    ->searchable()
                    ->preload(),
                TernaryFilter::make('is_promo')
                    ->label('Промо')
                    ->trueLabel('Только промо')
                    ->falseLabel('Только органика')
                    ->placeholder('Все'),
            ])
            ->recordActions([
                Action::make('scan_form')
                    ->label('Найти форму')
                    ->icon('heroicon-o-magnifying-glass')
                    ->requiresConfirmation()
                    ->action(function (Site $record): void {
                        $proxy = ProxyPicker::pick();
                        if ($proxy === null) {
                            app(\App\Services\DailyPipelineService::class)->notifyNoProxy('Скан форм не запущен (админка).');

                            Notification::make()
                                ->title('Нет доступного proxy')
                                ->body('Скан форм без proxy не запускается.')
                                ->danger()
                                ->send();

                            return;
                        }

                        $settings = ProjectSetting::query()->first();

                        $task = BotTask::query()->create([
                            'type' => 'scan_form',
                            'status' => 'queued',
                            'site_id' => $record->id,
                            'payload' => [
                                'taskId' => null, // filled after create
                                'siteId' => $record->id,
                                'url' => $record->url,
                                'maxFormMappings' => max(1, min(10, (int) ($settings?->max_form_mappings_per_site ?? 5))),
                                'proxy' => ProxyPicker::toPayload($proxy),
                                'proxyConfig' => ProxyPicker::configFromSettings($settings),
                            ],
                        ]);

                        $task->update([
                            'payload' => [
                                ...($task->payload ?? []),
                                'taskId' => $task->id,
                            ],
                        ]);

                        ProxyPicker::markUsed($proxy);

                        $record->update([
                            'status' => 'scanning',
                        ]);

                        Notification::make()
                            ->title("Задача scan_form #{$task->id} поставлена в очередь")
                            ->success()
                            ->send();
                    }),
                Action::make('manual_mapping')
                    ->label('Открыть ручную настройку')
                    ->icon('heroicon-o-cursor-arrow-rays')
                    ->url(fn (Site $record): string => ManualSiteMapping::getUrl(['record' => $record])),
                Action::make('test_submit')
                    ->label('Проверить отправку')
                    ->icon('heroicon-o-paper-airplane')
                    ->modalHeading('Проверить отправку формы')
                    ->modalDescription('Имя/фамилия и телефон подставятся автоматически: случайный пол из таблицы имён + номер из phone_grid региона сайта.')
                    ->modalSubmitActionLabel('Проверить')
                    ->requiresConfirmation()
                    ->action(function (Site $record): void {
                        if ($record->status === 'disabled') {
                            Notification::make()
                                ->title('Сайт отключён')
                                ->body('Включите сайт перед тестовой отправкой.')
                                ->warning()
                                ->send();

                            return;
                        }

                        if ($record->status !== 'ready') {
                            Notification::make()
                                ->title('Сайт не готов')
                                ->body('Сначала выполните сканирование или ручной маппинг.')
                                ->warning()
                                ->send();

                            return;
                        }

                        $mapping = SubmitLeadPayloadBuilder::pickMapping($record);
                        if (! $mapping) {
                            Notification::make()
                                ->title('Нет активного маппинга')
                                ->body('Сначала настройте и активируйте маппинг формы.')
                                ->warning()
                                ->send();

                            return;
                        }

                        try {
                            $identity = app(LeadIdentityGenerator::class)->generateForSite($record);
                        } catch (Throwable $e) {
                            Notification::make()
                                ->title('Не удалось сгенерировать имя/телефон')
                                ->body($e->getMessage())
                                ->danger()
                                ->send();

                            return;
                        }

                        $settings = ProjectSetting::query()->firstOrCreate([]);
                        $proxy = ProxyPicker::pick();

                        if ($proxy === null) {
                            app(\App\Services\DailyPipelineService::class)->notifyNoProxy('Тестовая отправка не запущена (админка).');

                            Notification::make()
                                ->title('Нет доступного proxy')
                                ->body('Отправка без proxy не запускается.')
                                ->danger()
                                ->send();

                            return;
                        }

                        $campaign = Campaign::query()->create([
                            'name' => "Тест отправки: {$record->name}",
                            'phone' => $identity['phone'],
                            'source' => 'web',
                            'status' => 'queued',
                            'total_sites' => 1,
                            'created_by' => Auth::id(),
                        ]);

                        $run = CampaignSiteRun::query()->create([
                            'campaign_id' => $campaign->id,
                            'site_id' => $record->id,
                            'proxy_id' => $proxy->id,
                            'status' => 'pending',
                        ]);

                        $task = BotTask::query()->create([
                            'type' => 'submit_lead',
                            'status' => 'queued',
                            'campaign_site_run_id' => $run->id,
                            'site_id' => $record->id,
                            'payload' => [
                                'taskId' => null,
                                'runId' => $run->id,
                                'url' => SubmitLeadPayloadBuilder::submitUrl($record, $mapping),
                                'name' => $identity['name'],
                                'phone' => $identity['phone'],
                                'region' => SubmitLeadPayloadBuilder::regionArray($record),
                                'screenshotConfig' => [
                                    'enabled' => false,
                                ],
                                'mapping' => SubmitLeadPayloadBuilder::mappingArray($mapping),
                                'proxy' => ProxyPicker::toPayload($proxy),
                                'proxyConfig' => ProxyPicker::configFromSettings($settings),
                            ],
                        ]);

                        $task->update([
                            'payload' => [
                                ...($task->payload ?? []),
                                'taskId' => $task->id,
                            ],
                        ]);

                        ProxyPicker::markUsed($proxy);

                        $operator = $identity['operator'] ? ", {$identity['operator']}" : '';
                        $region = $identity['region'] ?? '—';

                        Notification::make()
                            ->title("Тестовая отправка поставлена в очередь (#{$task->id})")
                            ->body("{$identity['gender']}: {$identity['name']}, тел. {$identity['phone']} ({$region}{$operator})")
                            ->success()
                            ->send();
                    }),
                Action::make('disable_site')
                    ->label('Отключить сайт')
                    ->color('danger')
                    ->icon('heroicon-o-no-symbol')
                    ->requiresConfirmation()
                    ->action(function (Site $record): void {
                        $record->update([
                            'status' => 'disabled',
                        ]);

                        Notification::make()
                            ->title('Сайт отключён')
                            ->success()
                            ->send();
                    }),
                EditAction::make(),
            ])
            ->toolbarActions([
                BulkActionGroup::make([
                    BulkAction::make('create_pipeline')
                        ->label('Автопайплайн')
                        ->icon('heroicon-o-queue-list')
                        ->color('primary')
                        ->deselectRecordsAfterCompletion()
                        ->modalHeading('Создать автопайплайн из выбранных сайтов')
                        ->modalDescription('Без выбора региона — у сайтов он уже есть. Можно смешивать регионы.')
                        ->modalSubmitActionLabel('Создать')
                        ->form([
                            Radio::make('mode')
                                ->label('Режим')
                                ->options([
                                    'scan_only' => 'Только сканировать формы',
                                    'submit_only' => 'Только отправить формы',
                                    'scan_and_submit' => 'Сканировать и отправить формы',
                                ])
                                ->default('scan_and_submit')
                                ->required(),
                            Radio::make('when')
                                ->label('Когда запустить')
                                ->options([
                                    'now' => 'Сейчас',
                                    'schedule' => 'По расписанию',
                                ])
                                ->default('now')
                                ->live()
                                ->required(),
                            DateTimePicker::make('scheduled_start_at')
                                ->label('Старт')
                                ->seconds(false)
                                ->native(false)
                                ->required(fn (callable $get): bool => $get('when') === 'schedule')
                                ->visible(fn (callable $get): bool => $get('when') === 'schedule'),
                            DateTimePicker::make('deadline_at')
                                ->label('Стоп (дедлайн)')
                                ->seconds(false)
                                ->native(false)
                                ->required(fn (callable $get): bool => $get('when') === 'schedule')
                                ->visible(fn (callable $get): bool => $get('when') === 'schedule'),
                            DateTimePicker::make('deadline_at_optional')
                                ->label('Стоп (необязательно)')
                                ->seconds(false)
                                ->native(false)
                                ->visible(fn (callable $get): bool => $get('when') === 'now')
                                ->helperText('Пусто = до ручной остановки.'),
                        ])
                        ->action(function (Collection $records, array $data): void {
                            $siteIds = $records->pluck('id')->map(fn ($id) => (int) $id)->filter()->values()->all();
                            if ($siteIds === []) {
                                Notification::make()->title('Нет сайтов')->warning()->send();

                                return;
                            }

                            try {
                                $when = (string) ($data['when'] ?? 'now');
                                $run = app(DailyPipelineService::class)->createFromSites([
                                    'mode' => (string) ($data['mode'] ?? 'scan_and_submit'),
                                    'site_ids' => $siteIds,
                                    'scheduled_start_at' => $when === 'schedule' ? ($data['scheduled_start_at'] ?? null) : null,
                                    'deadline_at' => $when === 'schedule'
                                        ? ($data['deadline_at'] ?? null)
                                        : ($data['deadline_at_optional'] ?? null),
                                ]);

                                Notification::make()
                                    ->title($run->status === 'pending'
                                        ? "Автопайплайн #{$run->id} запланирован"
                                        : "Автопайплайн #{$run->id} создан")
                                    ->body($run->stageLabel().' · сайтов: '.count($siteIds))
                                    ->success()
                                    ->send();
                            } catch (Throwable $e) {
                                Notification::make()
                                    ->title('Не удалось создать пайплайн')
                                    ->body($e->getMessage())
                                    ->danger()
                                    ->send();
                            }
                        }),
                    DataSyncFilamentActions::pushSelectedSitesBulkAction(),
                    DeleteBulkAction::make(),
                ]),
            ]);
    }
}
