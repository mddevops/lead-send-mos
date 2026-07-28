<?php

namespace App\Filament\Resources\DailyPipelineRuns\Pages;

use App\Filament\Resources\DailyPipelineRuns\DailyPipelineRunResource;
use App\Models\DailyPipelineRun;
use App\Services\DailyPipelineService;
use Filament\Actions\Action;
use Filament\Notifications\Notification;
use Filament\Resources\Pages\ViewRecord;

class ViewDailyPipelineRun extends ViewRecord
{
    protected static string $resource = DailyPipelineRunResource::class;

    protected function getHeaderActions(): array
    {
        return [
            Action::make('resume_submit')
                ->label('Продолжить отправку')
                ->icon('heroicon-o-play')
                ->color('success')
                ->requiresConfirmation()
                ->visible(fn (): bool => $this->record instanceof DailyPipelineRun
                    && ! $this->record->isActive()
                    && $this->record->discovery_run_id !== null
                    && in_array($this->record->status, ['failed', 'cancelled', 'timeout', 'completed'], true)
                    && ($this->record->scan_finished_at !== null || $this->record->forms_found_count > 0))
                ->action(function (): void {
                    /** @var DailyPipelineRun $record */
                    $record = $this->record;
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
                ->label('Остановить')
                ->icon('heroicon-o-stop')
                ->color('danger')
                ->requiresConfirmation()
                ->visible(fn (): bool => $this->record instanceof DailyPipelineRun && $this->record->isActive())
                ->action(function (): void {
                    /** @var DailyPipelineRun $record */
                    $record = $this->record;
                    app(DailyPipelineService::class)->stop($record);
                    Notification::make()
                        ->title("Прогон #{$record->id} остановлен")
                        ->success()
                        ->send();
                }),
        ];
    }
}
