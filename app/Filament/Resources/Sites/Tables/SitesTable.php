<?php

namespace App\Filament\Resources\Sites\Tables;

use App\Filament\Resources\Sites\Pages\ManualSiteMapping;
use App\Models\Site;
use App\Services\DailyPipelineService;
use App\Support\DataSyncFilamentActions;
use App\Support\ScanFormLauncher;
use App\Support\SubmitLeadPayloadBuilder;
use App\Support\TestFormSubmitEnqueuer;
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
                        $result = ScanFormLauncher::reuseOrEnqueue($record);

                        if ($result['mode'] === 'reused') {
                            $info = $result['result'];
                            Notification::make()
                                ->title('Маппинг взят с поддомена')
                                ->body("Донор #{$info['donor_id']} ({$info['donor_name']}), домен {$info['parent_domain']}, форм: {$info['mappings_count']}. Скан не нужен.")
                                ->success()
                                ->send();

                            return;
                        }

                        if ($result['mode'] === 'error') {
                            Notification::make()
                                ->title($result['title'])
                                ->body($result['body'])
                                ->danger()
                                ->send();

                            return;
                        }

                        Notification::make()
                            ->title("Задача scan_form #{$result['task_id']} поставлена в очередь")
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
                        $mapping = SubmitLeadPayloadBuilder::pickMapping($record);
                        if (! $mapping) {
                            Notification::make()
                                ->title('Нет активного маппинга')
                                ->body('Сначала настройте и активируйте маппинг формы.')
                                ->warning()
                                ->send();

                            return;
                        }

                        $result = TestFormSubmitEnqueuer::enqueue($record, $mapping);

                        if (! $result['ok']) {
                            Notification::make()
                                ->title($result['title'])
                                ->body($result['body'])
                                ->warning()
                                ->send();

                            return;
                        }

                        $identity = $result['identity'];
                        $operator = ! empty($identity['operator']) ? ", {$identity['operator']}" : '';
                        $region = $identity['region'] ?? '—';

                        Notification::make()
                            ->title("Тестовая отправка поставлена в очередь (#{$result['task_id']})")
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
