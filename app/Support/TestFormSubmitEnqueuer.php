<?php

namespace App\Support;

use App\Models\BotTask;
use App\Models\Campaign;
use App\Models\CampaignSiteRun;
use App\Models\FormMapping;
use App\Models\ProjectSetting;
use App\Models\Site;
use App\Services\DailyPipelineService;
use App\Services\LeadIdentityGenerator;
use Illuminate\Support\Facades\Auth;
use Throwable;

class TestFormSubmitEnqueuer
{
    /**
     * @return array{ok: true, task_id: int, identity: array<string, mixed>}|array{ok: false, title: string, body: string}
     */
    public static function enqueue(Site $site, FormMapping $mapping): array
    {
        if ((int) $mapping->site_id !== (int) $site->id) {
            return [
                'ok' => false,
                'title' => 'Маппинг чужого сайта',
                'body' => 'Выбранный маппинг не принадлежит этому сайту.',
            ];
        }

        if ($site->status === 'disabled') {
            return [
                'ok' => false,
                'title' => 'Сайт отключён',
                'body' => 'Включите сайт перед тестовой отправкой.',
            ];
        }

        try {
            $identity = app(LeadIdentityGenerator::class)->generateForSite($site);
        } catch (Throwable $e) {
            return [
                'ok' => false,
                'title' => 'Не удалось сгенерировать имя/телефон',
                'body' => $e->getMessage(),
            ];
        }

        $settings = ProjectSetting::query()->firstOrCreate([]);
        $proxy = ProxyPicker::pick();

        if ($proxy === null) {
            app(DailyPipelineService::class)->notifyNoProxy('Тестовая отправка не запущена (админка).');

            return [
                'ok' => false,
                'title' => 'Нет доступного proxy',
                'body' => 'Отправка без proxy не запускается.',
            ];
        }

        $campaign = Campaign::query()->create([
            'name' => "Тест отправки: {$site->name} (маппинг #{$mapping->id})",
            'phone' => $identity['phone'],
            'source' => 'web',
            'status' => 'queued',
            'total_sites' => 1,
            'created_by' => Auth::id(),
        ]);

        $run = CampaignSiteRun::query()->create([
            'campaign_id' => $campaign->id,
            'site_id' => $site->id,
            'proxy_id' => $proxy->id,
            'phone' => $identity['phone'],
            'status' => 'pending',
        ]);

        $task = BotTask::query()->create([
            'type' => 'submit_lead',
            'status' => 'queued',
            'campaign_site_run_id' => $run->id,
            'site_id' => $site->id,
            'payload' => [
                'taskId' => null,
                'runId' => $run->id,
                'url' => SubmitLeadPayloadBuilder::submitUrl($site, $mapping),
                'name' => $identity['name'],
                'first_name' => $identity['first_name'],
                'last_name' => $identity['last_name'],
                'email' => $identity['email'],
                'phone' => $identity['phone'],
                'region' => SubmitLeadPayloadBuilder::regionArray($site),
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

        return [
            'ok' => true,
            'task_id' => (int) $task->id,
            'identity' => $identity,
        ];
    }
}
