<?php

namespace App\Filament\Resources\DiscoveryRuns\RelationManagers;

use App\Filament\Resources\Sites\Pages\ManualSiteMapping;
use App\Filament\Resources\Sites\SiteResource;
use App\Models\BotTask;
use App\Models\ProjectSetting;
use App\Models\Site;
use App\Support\ProxyPicker;
use Filament\Actions\Action;
use Filament\Notifications\Notification;
use Filament\Resources\RelationManagers\RelationManager;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class SitesRelationManager extends RelationManager
{
    protected static string $relationship = 'sites';

    protected static ?string $title = 'Сайты';

    public function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('name')
                    ->label('Название')
                    ->searchable()
                    ->url(fn (Site $record): string => SiteResource::getUrl('edit', ['record' => $record]))
                    ->color('primary'),
                TextColumn::make('region.name')
                    ->label('Регион')
                    ->searchable(),
                TextColumn::make('url')
                    ->label('URL')
                    ->searchable()
                    ->limit(40)
                    ->tooltip(fn (Site $record): string => $record->url),
                TextColumn::make('ad_url')
                    ->label('Рекламная ссылка')
                    ->limit(50)
                    ->tooltip(fn (?string $state): ?string => $state)
                    ->placeholder('—')
                    ->wrap(),
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
                        'new' => 'gray',
                        'scanning' => 'info',
                        'ready' => 'success',
                        'needs_manual_mapping' => 'warning',
                        'mapping_failed' => 'danger',
                        'disabled' => 'danger',
                        default => 'gray',
                    }),
                TextColumn::make('last_scan_at')
                    ->label('Последнее сканирование')
                    ->dateTime('d.m.Y H:i')
                    ->sortable()
                    ->placeholder('—'),
                TextColumn::make('created_at')
                    ->label('Создано')
                    ->dateTime('d.m.Y H:i')
                    ->sortable()
                    ->toggleable(isToggledHiddenByDefault: true),
            ])
            ->defaultSort('id', 'desc')
            ->filters([
                SelectFilter::make('status')
                    ->label('Статус')
                    ->options([
                        'new' => 'Новый',
                        'scanning' => 'Сканирование',
                        'ready' => 'Готов',
                        'needs_manual_mapping' => 'Нужна ручная настройка',
                        'mapping_failed' => 'Ошибка маппинга',
                        'disabled' => 'Отключён',
                    ]),
            ])
            ->headerActions([])
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
                                'taskId' => null,
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
                    ->label('Ручная настройка')
                    ->icon('heroicon-o-cursor-arrow-rays')
                    ->url(fn (Site $record): string => ManualSiteMapping::getUrl(['record' => $record])),
                Action::make('edit')
                    ->label('Открыть')
                    ->icon('heroicon-o-pencil-square')
                    ->url(fn (Site $record): string => SiteResource::getUrl('edit', ['record' => $record])),
            ]);
    }
}
