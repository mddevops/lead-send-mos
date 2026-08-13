<?php

namespace App\Support;

use App\Models\BotTask;
use App\Models\ProjectSetting;
use App\Models\Site;
use App\Services\DailyPipelineService;
use App\Services\SiblingFormMappingReuseService;

final class ScanFormLauncher
{
    /**
     * Try sibling reuse first; otherwise enqueue scan_form.
     *
     * @return array{mode: 'reused', result: array}|array{mode: 'queued', task_id: int}|array{mode: 'error', title: string, body: string}
     */
    public static function reuseOrEnqueue(Site $site, ?int $pipelineRunId = null): array
    {
        $reuse = app(SiblingFormMappingReuseService::class)->tryReuseForSite($site);
        if ($reuse !== null) {
            return [
                'mode' => 'reused',
                'result' => $reuse,
            ];
        }

        $proxy = ProxyPicker::pick();
        if ($proxy === null) {
            app(DailyPipelineService::class)->notifyNoProxy('Скан форм не запущен.');

            return [
                'mode' => 'error',
                'title' => 'Нет доступного proxy',
                'body' => 'Скан форм без proxy не запускается.',
            ];
        }

        $settings = ProjectSetting::query()->first();

        $payload = [
            'taskId' => null,
            'siteId' => $site->id,
            'url' => $site->url,
            'maxFormMappings' => max(1, min(10, (int) ($settings?->max_form_mappings_per_site ?? 5))),
            'proxy' => ProxyPicker::toPayload($proxy),
            'proxyConfig' => ProxyPicker::configFromSettings($settings),
        ];

        if ($pipelineRunId !== null) {
            $payload['pipelineRunId'] = $pipelineRunId;
        }

        $site->update(['status' => 'scanning']);

        $task = BotTask::query()->create([
            'type' => 'scan_form',
            'status' => 'queued',
            'site_id' => $site->id,
            'payload' => $payload,
        ]);

        $task->update([
            'payload' => [
                ...($task->payload ?? []),
                'taskId' => $task->id,
            ],
        ]);

        ProxyPicker::markUsed($proxy);

        return [
            'mode' => 'queued',
            'task_id' => (int) $task->id,
        ];
    }
}
