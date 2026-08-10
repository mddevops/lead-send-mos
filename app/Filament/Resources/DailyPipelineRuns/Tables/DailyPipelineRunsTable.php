<?php

namespace App\Filament\Resources\DailyPipelineRuns\Tables;

use App\Filament\Resources\DailyPipelineRuns\DailyPipelineRunResource;
use App\Models\DailyPipelineRun;
use App\Services\DailyPipelineService;
use App\Support\DataSyncFilamentActions;
use Filament\Actions\Action;
use Filament\Actions\BulkAction;
use Filament\Actions\BulkActionGroup;
use Filament\Actions\DeleteAction;
use Filament\Actions\DeleteBulkAction;
use Filament\Actions\ViewAction;
use Filament\Forms\Components\Radio;
use Filament\Notifications\Notification;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Collection;

class DailyPipelineRunsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('id', 'desc')
            ->columns([
                TextColumn::make('id')->label('ID')->sortable(),
                TextColumn::make('run_date')->label('Дата')->date('d.m.Y')->sortable(),
                TextColumn::make('region.name')->label('Регион')->placeholder('несколько'),
                TextColumn::make('query')->label('Запрос')->limit(36)->searchable(),
                TextColumn::make('sites_count')
                    ->label('Сайтов')
                    ->state(fn (DailyPipelineRun $record): int => $record->sitesCount())
                    ->alignRight(),
                TextColumn::make('stage')
                    ->label('Этап')
                    ->state(fn (DailyPipelineRun $record): string => $record->stageLabel())
                    ->badge()
                    ->color(fn (DailyPipelineRun $record): string => match ($record->status) {
                        'discovering', 'pending' => 'info',
                        'scanning' => 'warning',
                        'submitting' => 'primary',
                        'paused_no_proxy' => 'danger',
                        'completed' => 'success',
                        'cancelled', 'timeout' => 'gray',
                        'failed' => 'danger',
                        default => 'gray',
                    }),
                TextColumn::make('status')
                    ->label('Статус')
                    ->badge()
                    ->formatStateUsing(fn (DailyPipelineRun $record): string => $record->statusLabel())
                    ->color(fn (DailyPipelineRun $record): string => match ($record->status) {
                        'discovering', 'scanning', 'submitting', 'pending' => 'info',
                        'paused_no_proxy' => 'warning',
                        'completed' => 'success',
                        'failed' => 'danger',
                        'cancelled', 'timeout' => 'gray',
                        default => 'gray',
                    }),
                TextColumn::make('promo_sites_count')->label('Промо')->alignRight()->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('forms_found_count')->label('Формы')->alignRight(),
                TextColumn::make('forms_not_found_count')->label('Без формы')->alignRight()->toggleable(),
                TextColumn::make('submit_lap')
                    ->label('Круг')
                    ->state(fn (DailyPipelineRun $record): string => (string) $record->submit_cycle_current)
                    ->alignRight(),
                TextColumn::make('submit_success_count')->label('OK')->alignRight(),
                TextColumn::make('submit_failed_count')->label('Err')->alignRight(),
                TextColumn::make('scheduled_start_at')
                    ->label('План старт')
                    ->dateTime('d.m H:i')
                    ->placeholder('—')
                    ->toggleable(),
                TextColumn::make('deadline_at')
                    ->label('Дедлайн')
                    ->formatStateUsing(fn ($state, DailyPipelineRun $record): string => $record->deadline_at
                        ? $record->deadline_at->format('d.m H:i')
                        : 'до стопа')
                    ->toggleable(),
                TextColumn::make('started_at')->label('Старт')->dateTime('H:i')->sortable(),
                TextColumn::make('finished_at')->label('Финиш')->dateTime('H:i'),
            ])
            ->recordUrl(fn (DailyPipelineRun $record) => DailyPipelineRunResource::getUrl('view', ['record' => $record]))
            ->actions([
                ViewAction::make(),
                Action::make('start')
                    ->label('Запустить')
                    ->icon('heroicon-o-play')
                    ->color('success')
                    ->modalHeading('Запустить пайплайн')
                    ->modalSubmitActionLabel('Запустить')
                    ->visible(fn (DailyPipelineRun $record): bool => ! $record->isActive()
                        && ! $record->isPausedNoProxy()
                        && app(DailyPipelineService::class)->siteIdsFor($record) !== [])
                    ->form([
                        Radio::make('mode')
                            ->label('Режим')
                            ->options([
                                'submit_only' => 'Только отправка форм',
                                'scan_only' => 'Только сканирование сайтов',
                                'scan_and_submit' => 'Сканирование + отправка форм',
                            ])
                            ->default('submit_only')
                            ->required(),
                    ])
                    ->action(function (DailyPipelineRun $record, array $data): void {
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
                        } catch (\Throwable $e) {
                            Notification::make()
                                ->title('Не удалось запустить')
                                ->body($e->getMessage())
                                ->danger()
                                ->send();
                        }
                    }),
                Action::make('resume_proxy')
                    ->label('Возобновить')
                    ->icon('heroicon-o-arrow-path')
                    ->color('warning')
                    ->visible(fn (DailyPipelineRun $record): bool => $record->isPausedNoProxy())
                    ->action(function (DailyPipelineRun $record): void {
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
                        } catch (\Throwable $e) {
                            Notification::make()
                                ->title('Не удалось возобновить')
                                ->body($e->getMessage())
                                ->danger()
                                ->send();
                        }
                    }),
                Action::make('stop')
                    ->label('Стоп')
                    ->icon('heroicon-o-stop')
                    ->color('danger')
                    ->requiresConfirmation()
                    ->visible(fn (DailyPipelineRun $record): bool => $record->isStoppable())
                    ->action(function (DailyPipelineRun $record): void {
                        app(DailyPipelineService::class)->stop($record);
                        Notification::make()
                            ->title("Прогон #{$record->id} остановлен")
                            ->success()
                            ->send();
                    }),
                DeleteAction::make()
                    ->label('Удалить')
                    ->modalHeading('Удалить автопайплайн?')
                    ->modalDescription('Удалится только запись прогона. Сайты и маппинги форм не трогаем.')
                    ->successNotificationTitle('Автопайплайн удалён')
                    ->before(function (DailyPipelineRun $record): void {
                        if ($record->isStoppable()) {
                            app(DailyPipelineService::class)->stop($record);
                        }
                    }),
            ])
            ->bulkActions([
                BulkActionGroup::make([
                    DataSyncFilamentActions::pushSelectedPipelinesBulkAction(),
                    BulkAction::make('stop_selected')
                        ->label('Остановить выбранные')
                        ->icon('heroicon-o-stop')
                        ->color('danger')
                        ->requiresConfirmation()
                        ->deselectRecordsAfterCompletion()
                        ->action(function (Collection $records): void {
                            $n = app(DailyPipelineService::class)->stopMany($records);
                            Notification::make()
                                ->title($n > 0 ? "Остановлено: {$n}" : 'Среди выбранных нет активных')
                                ->{$n > 0 ? 'success' : 'warning'}()
                                ->send();
                        }),
                    DeleteBulkAction::make()
                        ->label('Удалить выбранные')
                        ->modalHeading('Удалить выбранные автопайплайны?')
                        ->modalDescription('Удалятся только записи прогонов. Сайты и маппинги форм останутся.')
                        ->successNotificationTitle('Автопайплайны удалены')
                        ->before(function (Collection $records): void {
                            $service = app(DailyPipelineService::class);
                            foreach ($records as $record) {
                                if ($record instanceof DailyPipelineRun && $record->isStoppable()) {
                                    $service->stop($record);
                                }
                            }
                        }),
                ]),
            ]);
    }
}
