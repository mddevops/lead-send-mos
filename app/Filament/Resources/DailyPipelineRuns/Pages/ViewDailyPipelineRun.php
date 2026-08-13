<?php

namespace App\Filament\Resources\DailyPipelineRuns\Pages;

use App\Filament\Resources\DailyPipelineRuns\DailyPipelineRunResource;
use App\Filament\Resources\Sites\Pages\ManualSiteMapping;
use App\Filament\Resources\Sites\SiteResource;
use App\Models\BotTask;
use App\Models\Campaign;
use App\Models\CampaignSiteRun;
use App\Models\DailyPipelineRun;
use App\Models\ProjectSetting;
use App\Models\Site;
use App\Services\DailyPipelineService;
use App\Services\LeadIdentityGenerator;
use App\Support\PipelineSitesExcelExport;
use App\Support\ProxyPicker;
use App\Support\SubmitLeadPayloadBuilder;
use Filament\Actions\Action;
use Filament\Actions\DeleteAction;
use Filament\Forms\Components\Radio;
use Filament\Notifications\Notification;
use Filament\Resources\Pages\ViewRecord;
use Filament\Schemas\Components\EmbeddedTable;
use Filament\Schemas\Schema;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Concerns\InteractsWithTable;
use Filament\Tables\Contracts\HasTable;
use Filament\Tables\Table;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Throwable;

class ViewDailyPipelineRun extends ViewRecord implements HasTable
{
    use InteractsWithTable;

    protected static string $resource = DailyPipelineRunResource::class;

    public function mount(int|string $record): void
    {
        parent::mount($record);
        $this->refreshPipelineStats();
    }

    public function content(Schema $schema): Schema
    {
        return $schema->components([
            $this->getInfolistContentComponent(),
            EmbeddedTable::make(),
        ]);
    }

    public function table(Table $table): Table
    {
        /** @var DailyPipelineRun $pipeline */
        $pipeline = $this->getRecord();
        $ids = app(DailyPipelineService::class)->siteIdsFor($pipeline);
        $count = count($ids);
        if ($ids === []) {
            $ids = [0];
        }

        $submitStats = app(DailyPipelineService::class)->submitStatsBySite($pipeline);

        return $table
            ->query(
                Site::query()
                    ->whereIn('id', $ids)
                    ->with(['region', 'formMappings' => fn ($q) => $q->where('status', 'active')])
                    ->orderBy('id'),
            )
            ->heading('Сайты пайплайна ('.$count.')')
            ->description('Статистика форм и отправок обновляется при открытии и каждые 15 сек.')
            ->columns([
                TextColumn::make('id')->label('ID')->sortable(),
                TextColumn::make('name')
                    ->label('Название')
                    ->searchable()
                    ->limit(28)
                    ->url(fn (Site $record): string => SiteResource::getUrl('edit', ['record' => $record]))
                    ->color('primary'),
                TextColumn::make('url')
                    ->label('URL')
                    ->searchable()
                    ->limit(36)
                    ->tooltip(fn (Site $record): string => $record->url)
                    ->copyable(),
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
                    })
                    ->color(fn (string $state): string => match ($state) {
                        'ready' => 'success',
                        'scanning' => 'info',
                        'needs_manual_mapping', 'mapping_failed' => 'warning',
                        'disabled' => 'danger',
                        default => 'gray',
                    }),
                IconColumn::make('has_form')
                    ->label('Форма')
                    ->boolean()
                    ->state(fn (Site $record): bool => $record->status === 'ready'
                        && $record->formMappings->isNotEmpty()),
                TextColumn::make('submit_total')
                    ->label('Отправлено')
                    ->alignRight()
                    ->state(fn (Site $record): int => $submitStats[$record->id]['total'] ?? 0),
                TextColumn::make('submit_failed')
                    ->label('Ошибки')
                    ->alignRight()
                    ->state(fn (Site $record): int => $submitStats[$record->id]['failed'] ?? 0)
                    ->color(fn (Site $record) => ($submitStats[$record->id]['failed'] ?? 0) > 0 ? 'danger' : 'gray'),
                TextColumn::make('submit_unknown')
                    ->label('Неизв.')
                    ->alignRight()
                    ->toggleable(isToggledHiddenByDefault: true)
                    ->state(fn (Site $record): int => $submitStats[$record->id]['unknown'] ?? 0),
                TextColumn::make('last_scan_at')
                    ->label('Скан')
                    ->dateTime('d.m H:i')
                    ->placeholder('—')
                    ->toggleable(),
            ])
            ->headerActions([
                Action::make('export')
                    ->label('Экспорт')
                    ->icon('heroicon-o-arrow-down-tray')
                    ->color('success')
                    ->action(function () use ($ids, $submitStats): BinaryFileResponse {
                        /** @var DailyPipelineRun $pipeline */
                        $pipeline = $this->getRecord();
                        $pipeline->loadMissing('region');

                        $service = app(DailyPipelineService::class);
                        $sites = Site::query()
                            ->whereIn('id', $ids === [0] ? [] : $ids)
                            ->orderBy('id')
                            ->get(['id', 'name', 'url']);

                        $rows = [];
                        foreach ($sites as $site) {
                            $stats = $submitStats[$site->id] ?? null;
                            $rows[] = [
                                'name' => (string) ($site->name ?: $site->url),
                                'total' => (int) ($stats['total'] ?? 0),
                                'failed' => (int) ($stats['failed'] ?? 0),
                            ];
                        }

                        $range = $service->submitTimeRange($pipeline);

                        return PipelineSitesExcelExport::downloadXlsx(
                            $rows,
                            (string) ($pipeline->region?->name ?? 'region'),
                            $range['start']?->format('Y-m-d H:i:s'),
                            $range['end']?->format('Y-m-d H:i:s'),
                        );
                    }),
            ])
            ->actions([
                \Filament\Actions\Action::make('manual_mapping')
                    ->label('Маппинг')
                    ->icon('heroicon-o-wrench-screwdriver')
                    ->url(fn (Site $record): string => ManualSiteMapping::getUrl(['record' => $record])),
                \Filament\Actions\Action::make('test_submit')
                    ->label('Проверить отправку')
                    ->icon('heroicon-o-paper-airplane')
                    ->color('success')
                    ->modalHeading('Проверить отправку формы')
                    ->modalDescription('Имя/фамилия и телефон подставятся автоматически: случайный пол из таблицы имён + номер из phone_grid региона сайта.')
                    ->modalSubmitActionLabel('Проверить')
                    ->requiresConfirmation()
                    ->visible(fn (Site $record): bool => $record->status === 'ready'
                        && $record->formMappings->isNotEmpty())
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
                            app(DailyPipelineService::class)->notifyNoProxy('Тестовая отправка не запущена (пайплайн).');

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
                                'first_name' => $identity['first_name'],
                                'last_name' => $identity['last_name'],
                                'email' => $identity['email'],
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
            ])
            ->paginated([25, 50, 100])
            ->defaultPaginationPageOption(25)
            ->poll('15s');
    }

    public function rendering(): void
    {
        $this->refreshPipelineStats();
    }

    protected function refreshPipelineStats(): void
    {
        if (! $this->record instanceof DailyPipelineRun) {
            return;
        }

        try {
            app(DailyPipelineService::class)->refreshFormStats($this->record);
            $this->record->refresh();
        } catch (Throwable) {
            // Keep page usable if refresh fails.
        }
    }

    protected function getHeaderActions(): array
    {
        return [
            Action::make('start')
                ->label('Запустить')
                ->icon('heroicon-o-play')
                ->color('success')
                ->modalHeading('Запустить пайплайн')
                ->modalSubmitActionLabel('Запустить')
                ->visible(fn (): bool => $this->record instanceof DailyPipelineRun
                    && ! $this->record->isActive()
                    && ! $this->record->isPausedNoProxy()
                    && app(DailyPipelineService::class)->siteIdsFor($this->record) !== [])
                ->form([
                    Radio::make('mode')
                        ->label('Режим')
                        ->options([
                            'submit_only' => 'Только отправка форм',
                            'scan_only' => 'Только сканирование сайтов',
                            'scan_and_submit' => 'Сканирование + отправка форм',
                        ])
                        ->default('submit_only')
                        ->required()
                        ->helperText('После ручного маппинга обычно достаточно «Только отправка».'),
                ])
                ->action(function (array $data): void {
                    /** @var DailyPipelineRun $record */
                    $record = $this->record;
                    try {
                        $fresh = app(DailyPipelineService::class)->start(
                            $record,
                            (string) ($data['mode'] ?? 'submit_only'),
                        );
                        Notification::make()
                            ->title("Пайплайн #{$fresh->id} запущен")
                            ->body($fresh->stageLabel())
                            ->success()
                            ->send();
                        $this->record = $fresh;
                        $this->refreshPipelineStats();
                    } catch (Throwable $e) {
                        Notification::make()
                            ->title('Не удалось запустить')
                            ->body($e->getMessage())
                            ->danger()
                            ->send();
                    }
                }),
            Action::make('resume_proxy')
                ->label('Возобновить (прокси)')
                ->icon('heroicon-o-arrow-path')
                ->color('warning')
                ->visible(fn (): bool => $this->record instanceof DailyPipelineRun && $this->record->isPausedNoProxy())
                ->action(function (): void {
                    /** @var DailyPipelineRun $record */
                    $record = $this->record;
                    try {
                        $service = app(DailyPipelineService::class);
                        $fresh = ($record->source ?? '') === 'sites'
                            ? $service->beginSitesPipelineWork($record)
                            : $service->start($record, 'scan_and_submit');
                        Notification::make()
                            ->title("Пайплайн #{$fresh->id}")
                            ->body($fresh->stageLabel())
                            ->success()
                            ->send();
                        $this->record = $fresh;
                        $this->refreshPipelineStats();
                    } catch (Throwable $e) {
                        Notification::make()
                            ->title('Не удалось возобновить')
                            ->body($e->getMessage())
                            ->danger()
                            ->send();
                    }
                }),
            Action::make('stop')
                ->label('Остановить')
                ->icon('heroicon-o-stop')
                ->color('danger')
                ->requiresConfirmation()
                ->visible(fn (): bool => $this->record instanceof DailyPipelineRun && $this->record->isStoppable())
                ->action(function (): void {
                    /** @var DailyPipelineRun $record */
                    $record = $this->record;
                    app(DailyPipelineService::class)->stop($record);
                    Notification::make()
                        ->title("Прогон #{$record->id} остановлен")
                        ->success()
                        ->send();
                    $this->record->refresh();
                    $this->refreshPipelineStats();
                }),
            DeleteAction::make()
                ->label('Удалить')
                ->modalHeading('Удалить автопайплайн?')
                ->modalDescription('Удалится только запись прогона. Сайты и маппинги форм не трогаем.')
                ->successNotificationTitle('Автопайплайн удалён')
                ->before(function (): void {
                    /** @var DailyPipelineRun $record */
                    $record = $this->record;
                    if ($record->isStoppable()) {
                        app(DailyPipelineService::class)->stop($record);
                    }
                }),
        ];
    }
}
