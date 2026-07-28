<?php

namespace App\Services;

use App\Models\BotTask;
use App\Models\Campaign;
use App\Models\CampaignSiteRun;
use Illuminate\Support\Collection;

class TelegramCampaignService
{
    public function listActiveForChat(string $chatId): string
    {
        $campaigns = Campaign::query()
            ->where('telegram_chat_id', $chatId)
            ->whereIn('status', ['queued', 'processing'])
            ->latest('id')
            ->get();

        if ($campaigns->isEmpty()) {
            return "Активных процессов нет.\n\nЗапустить: /start";
        }

        $lines = ['Активные процессы:', ''];

        foreach ($campaigns as $campaign) {
            $lines[] = $this->formatCampaignSummary($campaign);
            $lines[] = "Остановить: /stop {$campaign->id}";
            $lines[] = '';
        }

        return trim(implode("\n", $lines));
    }

    public function cancelForChat(string $chatId, int $campaignId): string
    {
        $campaign = Campaign::query()
            ->where('id', $campaignId)
            ->where('telegram_chat_id', $chatId)
            ->whereIn('status', ['queued', 'processing'])
            ->first();

        if ($campaign === null) {
            return 'Процесс не найден, уже завершён или недоступен для остановки.';
        }

        $runIds = $campaign->runs()->pluck('id');

        $deletedTasks = BotTask::query()
            ->whereIn('campaign_site_run_id', $runIds)
            ->where('status', 'queued')
            ->delete();

        $skippedRuns = CampaignSiteRun::query()
            ->where('campaign_id', $campaign->id)
            ->where('status', 'pending')
            ->update([
                'status' => 'skipped',
                'skip_reason' => 'cancelled_from_telegram',
                'finished_at' => now(),
            ]);

        $processingCount = $campaign->runs()->where('status', 'processing')->count();

        $campaign->update([
            'status' => 'cancelled',
            'finished_at' => now(),
            'telegram_status_notified_at' => now(),
            'skipped_count' => $campaign->runs()->where('status', 'skipped')->count(),
            'success_count' => $campaign->runs()->where('status', 'success')->count(),
            'failed_count' => $campaign->runs()->where('status', 'failed')->count(),
            'unknown_count' => $campaign->runs()->where('status', 'unknown')->count(),
        ]);

        $message = "Процесс #{$campaign->id} остановлен.\n"
            ."Удалено из очереди: {$deletedTasks}\n"
            ."Пропущено сайтов: {$skippedRuns}";

        if ($processingCount > 0) {
            $message .= "\nВ работе сейчас: {$processingCount} (завершат текущий сайт и остановятся).";
        }

        return $message;
    }

    private function formatCampaignSummary(Campaign $campaign): string
    {
        $queued = $this->taskCount($campaign, 'queued');
        $processing = $campaign->runs()->where('status', 'processing')->count();
        $pending = $campaign->runs()->where('status', 'pending')->count();
        $success = $campaign->runs()->where('status', 'success')->count();
        $failed = $campaign->runs()->where('status', 'failed')->count();

        $statusLabel = match ($campaign->status) {
            'queued' => 'в очереди',
            'processing' => 'в работе',
            default => $campaign->status,
        };

        return "Процесс #{$campaign->id} ({$statusLabel})\n"
            ."Имя: {$campaign->name}\n"
            ."Телефон: {$campaign->phone}\n"
            ."Ожидают: {$pending}, в очереди: {$queued}, в работе: {$processing}\n"
            ."Готово: {$success}, ошибки: {$failed}";
    }

    private function taskCount(Campaign $campaign, string $status): int
    {
        $runIds = $campaign->runs()->pluck('id');

        if ($runIds instanceof Collection && $runIds->isEmpty()) {
            return 0;
        }

        return BotTask::query()
            ->whereIn('campaign_site_run_id', $runIds)
            ->where('status', $status)
            ->count();
    }
}
