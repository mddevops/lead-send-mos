<?php

namespace App\Filament\Resources\BotTaskLogs\Pages;

use App\Filament\Resources\BotTaskLogs\BotTaskLogResource;
use App\Models\BotTask;
use App\Models\CampaignSiteRun;
use Filament\Actions\Action;
use Filament\Notifications\Notification;
use Filament\Resources\Pages\ListRecords;

class ListBotTaskLogs extends ListRecords
{
    protected static string $resource = BotTaskLogResource::class;

    protected function getHeaderActions(): array
    {
        return [
            Action::make('clearQueuedTasks')
                ->label('Очистить очередь')
                ->icon('heroicon-o-trash')
                ->color('danger')
                ->requiresConfirmation()
                ->modalHeading('Очистить очередь задач')
                ->modalDescription('Удалит задачи в статусе queued и пометит связанные pending/processing запуски как skipped.')
                ->action(function (): void {
                    $runIds = BotTask::query()
                        ->where('type', 'submit_lead')
                        ->where('status', 'queued')
                        ->whereNotNull('campaign_site_run_id')
                        ->pluck('campaign_site_run_id')
                        ->filter()
                        ->values();

                    $deleted = BotTask::query()
                        ->where('status', 'queued')
                        ->delete();

                    if ($runIds->isNotEmpty()) {
                        CampaignSiteRun::query()
                            ->whereIn('id', $runIds)
                            ->whereIn('status', ['pending', 'processing'])
                            ->update([
                                'status' => 'skipped',
                                'skip_reason' => 'queue_cleared_from_admin',
                                'finished_at' => now(),
                            ]);
                    }

                    Notification::make()
                        ->title('Очередь очищена')
                        ->body("Удалено задач: {$deleted}")
                        ->success()
                        ->send();
                }),
        ];
    }
}
