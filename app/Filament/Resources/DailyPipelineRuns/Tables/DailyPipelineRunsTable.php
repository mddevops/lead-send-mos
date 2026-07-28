<?php

namespace App\Filament\Resources\DailyPipelineRuns\Tables;

use App\Filament\Resources\DailyPipelineRuns\DailyPipelineRunResource;
use App\Models\DailyPipelineRun;
use App\Services\DailyPipelineService;
use Filament\Actions\Action;
use Filament\Actions\BulkAction;
use Filament\Actions\BulkActionGroup;
use Filament\Actions\ViewAction;
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
                TextColumn::make('region.name')->label('Регион'),
                TextColumn::make('query')->label('Запрос')->limit(36)->searchable(),
                TextColumn::make('stage')
                    ->label('Этап')
                    ->state(fn (DailyPipelineRun $record): string => $record->stageLabel())
                    ->badge()
                    ->color(fn (DailyPipelineRun $record): string => match ($record->status) {
                        'discovering', 'pending' => 'info',
                        'scanning' => 'warning',
                        'submitting' => 'primary',
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
                        'completed' => 'success',
                        'failed' => 'danger',
                        'cancelled', 'timeout' => 'gray',
                        default => 'gray',
                    }),
                TextColumn::make('promo_sites_count')->label('Промо')->alignRight(),
                TextColumn::make('forms_found_count')->label('Формы')->alignRight(),
                TextColumn::make('forms_not_found_count')->label('Без формы')->alignRight()->toggleable(),
                TextColumn::make('submit_lap')
                    ->label('Круг')
                    ->state(fn (DailyPipelineRun $record): string => (string) $record->submit_cycle_current)
                    ->alignRight(),
                TextColumn::make('submit_success_count')->label('OK')->alignRight(),
                TextColumn::make('submit_failed_count')->label('Err')->alignRight(),
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
                Action::make('resume_submit')
                    ->label('Продолжить отправку')
                    ->icon('heroicon-o-play')
                    ->color('success')
                    ->requiresConfirmation()
                    ->visible(fn (DailyPipelineRun $record): bool => ! $record->isActive()
                        && $record->discovery_run_id !== null
                        && in_array($record->status, ['failed', 'cancelled', 'timeout', 'completed'], true)
                        && ($record->scan_finished_at !== null || $record->forms_found_count > 0))
                    ->action(function (DailyPipelineRun $record): void {
                        try {
                            $fresh = app(DailyPipelineService::class)->resumeSubmit($record);
                            Notification::make()
                                ->title("Отправка возобновлена (круг {$fresh->submit_cycle_current})")
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
                    ->visible(fn (DailyPipelineRun $record): bool => $record->isActive())
                    ->action(function (DailyPipelineRun $record): void {
                        app(DailyPipelineService::class)->stop($record);
                        Notification::make()
                            ->title("Прогон #{$record->id} остановлен")
                            ->success()
                            ->send();
                    }),
            ])
            ->bulkActions([
                BulkActionGroup::make([
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
                ]),
            ]);
    }
}
