<?php

namespace App\Filament\Resources\DiscoveryRuns\RelationManagers;

use App\Filament\Resources\Sites\Pages\ManualSiteMapping;
use App\Filament\Resources\Sites\SiteResource;
use App\Models\DiscoveryRun;
use App\Models\Site;
use App\Support\ScanFormLauncher;
use App\Support\SitesExcelExport;
use Filament\Actions\Action;
use Filament\Actions\BulkAction;
use Filament\Actions\BulkActionGroup;
use Filament\Notifications\Notification;
use Filament\Resources\RelationManagers\RelationManager;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

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
                    ->tooltip(fn (Site $record): string => $record->url)
                    ->copyable()
                    ->copyMessage('URL скопирован'),
                TextColumn::make('ad_url')
                    ->label('Рекламная ссылка')
                    ->limit(50)
                    ->tooltip(fn (?string $state): ?string => $state)
                    ->placeholder('—')
                    ->wrap(),
                IconColumn::make('is_promo')
                    ->label('Промо')
                    ->boolean()
                    ->trueIcon('heroicon-o-megaphone')
                    ->falseIcon('heroicon-o-document-text')
                    ->trueColor('warning')
                    ->falseColor('gray'),
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
                TernaryFilter::make('is_promo')
                    ->label('Промо')
                    ->trueLabel('Только промо')
                    ->falseLabel('Только органика')
                    ->placeholder('Все'),
            ])
            ->headerActions([
                Action::make('exportExcel')
                    ->label('Экспорт в Excel')
                    ->icon('heroicon-o-arrow-down-tray')
                    ->color('success')
                    ->action(function (): BinaryFileResponse {
                        /** @var DiscoveryRun $run */
                        $run = $this->getOwnerRecord();

                        $sites = $run->sites()
                            ->with('region')
                            ->orderBy('id')
                            ->get();

                        return SitesExcelExport::downloadXlsx(
                            $sites,
                            'discovery-'.$run->id.'-sites',
                        );
                    }),
            ])
            ->toolbarActions([
                BulkActionGroup::make([
                    BulkAction::make('exportSelected')
                        ->label('Экспорт выбранных')
                        ->icon('heroicon-o-arrow-down-tray')
                        ->action(function (EloquentCollection $records): BinaryFileResponse {
                            /** @var DiscoveryRun $run */
                            $run = $this->getOwnerRecord();

                            $sites = $records
                                ->loadMissing('region')
                                ->sortBy('id')
                                ->values();

                            return SitesExcelExport::downloadXlsx(
                                $sites,
                                'discovery-'.$run->id.'-selected',
                            );
                        })
                        ->deselectRecordsAfterCompletion(),
                ]),
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
