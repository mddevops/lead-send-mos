<?php

namespace App\Services;

use App\Models\BotTask;
use App\Models\Campaign;
use App\Models\CampaignSiteRun;
use App\Models\DailyPipelineRun;
use App\Models\ProjectSetting;
use App\Models\Proxy;
use App\Models\Region;
use App\Models\Site;
use App\Support\ProxyPicker;
use App\Support\SubmitLeadPayloadBuilder;
use Carbon\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

class DailyPipelineService
{
    public function __construct(
        private readonly YandexAdsDiscoveryService $discovery,
        private readonly LeadIdentityGenerator $identityGenerator,
        private readonly TelegramNotifier $telegram,
    ) {}

    public function tick(): void
    {
        $settings = ProjectSetting::query()->firstOrCreate([]);
        $actives = DailyPipelineRun::query()
            ->whereIn('status', ['pending', 'discovering', 'scanning', 'submitting'])
            ->orderBy('id')
            ->get();

        foreach ($actives as $active) {
            $tz = (string) ($active->timezone ?: 'Europe/Moscow');
            $now = Carbon::now($tz);

            if ($active->deadline_at !== null && $now->greaterThanOrEqualTo($active->deadline_at)) {
                $this->finalize($active, 'timeout', 'Достигнут дедлайн '.($active->deadline_time ?: ''));

                continue;
            }

            $this->advance($active, $settings);
        }

        if (! (bool) ($settings->pipeline_enabled ?? false)) {
            return;
        }

        $tz = (string) ($settings->pipeline_timezone ?: 'Europe/Moscow');
        $now = Carbon::now($tz);

        if (! $this->shouldStartToday($settings, $now)) {
            return;
        }

        try {
            $this->startFromSettings($settings, $now);
        } catch (Throwable $e) {
            Log::warning('pipeline.start_failed', ['error' => $e->getMessage()]);
            $message = $e->getMessage();
            if (stripos($message, 'proxy') !== false) {
                $this->notifyNoProxy('Автопайплайн не стартовал: '.$message);
            } else {
                $this->alert($settings, "⚠️ Автопайплайн не стартовал\n{$message}");
            }
        }
    }

    /**
     * Create & start now from admin. Runs until manual stop (no deadline).
     *
     * @param  array{
     *   region_id:int,
     *   query?:string|null,
     *   max_pages?:int,
     *   timezone?:string,
     *   start_time?:string,
     *   deadline_time?:string|null,
     *   run_until_stopped?:bool
     * }  $data
     */
    public function create(array $data): DailyPipelineRun
    {
        $region = Region::query()->findOrFail((int) $data['region_id']);
        $tz = (string) ($data['timezone'] ?? 'Europe/Moscow');
        $now = Carbon::now($tz);
        $runUntilStopped = array_key_exists('deadline_time', $data)
            ? ($data['deadline_time'] === null || $data['deadline_time'] === '')
            : true;

        if ($this->pickProxy() === null) {
            $this->notifyNoProxy('Создание автопайплайна отменено.');

            throw new \RuntimeException('Нет доступного proxy');
        }

        $query = $this->discovery->buildQuery(
            $region,
            is_string($data['query'] ?? null) ? $data['query'] : null,
        );

        $deadlineAt = null;
        $deadlineTime = null;
        $startTime = $now->format('H:i');

        if (! $runUntilStopped) {
            $deadlineTime = (string) ($data['deadline_time'] ?? '18:00');
            $startTime = (string) ($data['start_time'] ?? $startTime);
            $deadlineAt = $this->resolveDeadline($deadlineTime, $now)
                ->copy()
                ->timezone(config('app.timezone'));
        }

        $pipeline = DailyPipelineRun::query()->create([
            'run_date' => $now->toDateString(),
            'status' => 'discovering',
            'region_id' => $region->id,
            'query' => $query,
            'max_pages' => max(1, min(5, (int) ($data['max_pages'] ?? 3))),
            'use_proxy' => true,
            'scan_forms' => true,
            'submit_forms' => true,
            'submit_cycles_min' => 1,
            'submit_cycles_max' => 1,
            'submit_cycles_planned' => 0,
            'submit_cycle_current' => 0,
            'timezone' => $tz,
            'start_time' => $startTime,
            'deadline_time' => $deadlineTime,
            'started_at' => now(),
            'deadline_at' => $deadlineAt,
        ]);

        try {
            $queued = $this->discovery->queueRun(
                $region,
                (int) $pipeline->max_pages,
                true,
                $query,
            );
            $pipeline->update(['discovery_run_id' => $queued['run']->id]);
        } catch (Throwable $e) {
            $this->finalize($pipeline, 'failed', $e->getMessage());

            throw $e;
        }

        Log::info('pipeline.created', [
            'id' => $pipeline->id,
            'query' => $query,
            'until_stopped' => $runUntilStopped,
        ]);

        return $pipeline->fresh();
    }

    /** @deprecated use create() */
    public function startNow(?string $forceQuery = null): DailyPipelineRun
    {
        $settings = ProjectSetting::query()->firstOrCreate([]);
        if (! $settings->pipeline_region_id) {
            throw new \RuntimeException('В настройках автопайплайна не выбран регион');
        }

        return $this->create([
            'region_id' => (int) $settings->pipeline_region_id,
            'query' => $forceQuery ?? $settings->pipeline_query_template,
            'max_pages' => (int) ($settings->pipeline_max_pages ?? 3),
            'timezone' => $settings->pipeline_timezone ?: 'Europe/Moscow',
            // Manual startNow — until stopped.
            'deadline_time' => null,
        ]);
    }

    public function stop(DailyPipelineRun $pipeline): void
    {
        if (! $pipeline->isActive()) {
            return;
        }

        $this->cancelRelatedWork($pipeline);
        $this->finalize($pipeline, 'cancelled', 'Остановлено вручную');
    }

    /**
     * @param  Collection<int, DailyPipelineRun>|iterable<DailyPipelineRun>  $pipelines
     */
    public function stopMany(iterable $pipelines): int
    {
        $count = 0;
        foreach ($pipelines as $pipeline) {
            if ($pipeline->isActive()) {
                $this->stop($pipeline);
                $count++;
            }
        }

        return $count;
    }

    public function stopAllActive(): int
    {
        $actives = DailyPipelineRun::query()
            ->whereIn('status', ['pending', 'discovering', 'scanning', 'submitting'])
            ->get();

        return $this->stopMany($actives);
    }

    /**
     * Resume / continue form-submit stage after fail or manual stop of submitting.
     * Starts the next submit lap (1→N) until manual stop / deadline.
     */
    public function resumeSubmit(DailyPipelineRun $pipeline): DailyPipelineRun
    {
        if ($pipeline->discovery_run_id === null) {
            throw new \RuntimeException('У пайплайна нет прогона поиска');
        }

        if ($pipeline->scan_finished_at === null && $pipeline->status === 'discovering') {
            throw new \RuntimeException('Сначала нужно завершить поиск и скан форм');
        }

        if ($this->pickProxy() === null) {
            $this->notifyNoProxy('Возобновление отправки отменено.');

            throw new \RuntimeException('Нет доступного proxy');
        }

        $readyCount = Site::query()
            ->where('discovery_run_id', $pipeline->discovery_run_id)
            ->where('status', 'ready')
            ->whereHas('formMappings', fn ($q) => $q->where('status', 'active'))
            ->count();

        if ($readyCount === 0) {
            throw new \RuntimeException('Нет сайтов со статусом ready и активной формой');
        }

        $settings = ProjectSetting::query()->firstOrCreate([]);

        $pipeline->update([
            'status' => 'submitting',
            'submit_forms' => true,
            'error_message' => null,
            'finished_at' => null,
            'submit_finished_at' => null,
            'alert_no_proxy_sent_at' => null,
        ]);

        $this->startNextSubmitLap($pipeline->fresh(), $settings);

        Log::info('pipeline.resume_submit', [
            'id' => $pipeline->id,
            'ready_sites' => $readyCount,
            'cycle' => $pipeline->fresh()?->submit_cycle_current,
        ]);

        return $pipeline->fresh();
    }

    public static function isFatalCaptchaError(string $message): bool
    {
        return (bool) preg_match(
            '/ERROR_ZERO_BALANCE|ERROR_KEY_DOES_NOT_EXIST|ERROR_WRONG_USER_KEY|ERROR_IP_NOT_ALLOWED|CAPTCHA_SOLVER_ENABLED=true и CAPTCHA_SOLVER_API_KEY/iu',
            $message,
        );
    }

    public function notifyZeroBalance(string $message): void
    {
        $this->notifyCaptchaFailure($message);
    }

    public function notifyCaptchaFailure(string $message): void
    {
        $keyFromMessage = null;
        if (preg_match('/captcha_key=([^\s\]]+)/u', $message, $m)) {
            $keyFromMessage = $m[1];
        }

        $laravelKey = (string) env('CAPTCHA_SOLVER_API_KEY', '');
        $laravelKeyHint = $laravelKey === ''
            ? '(empty)'
            : (strlen($laravelKey) <= 8
                ? substr($laravelKey, 0, 2).'…(len='.strlen($laravelKey).')'
                : substr($laravelKey, 0, 4).'…'.substr($laravelKey, -4).' (len='.strlen($laravelKey).')');

        Log::error('captcha.fatal', [
            'message' => $message,
            'worker_captcha_key_hint' => $keyFromMessage,
            'laravel_env_captcha_key_hint' => $laravelKeyHint,
            'laravel_env_provider' => env('CAPTCHA_SOLVER_PROVIDER'),
        ]);

        if (! $this->shouldSendAlert('captcha', 'alert_zero_balance_sent_at')) {
            return;
        }

        $settings = ProjectSetting::query()->firstOrCreate([]);
        $this->alert(
            $settings,
            "⚠️ ruCaptcha не работает\n{$message}\nПроверьте баланс / API-ключ / IP whitelist.",
        );
    }

    public function notifyNoProxy(string $context = ''): void
    {
        if (! $this->shouldSendAlert('no_proxy', 'alert_no_proxy_sent_at')) {
            return;
        }

        $settings = ProjectSetting::query()->firstOrCreate([]);
        $suffix = $context !== '' ? "\n{$context}" : '';
        $this->alert($settings, "⚠️ Нет рабочих proxy{$suffix}");
    }

    /**
     * Deduplicate alerts: once per active pipeline run, otherwise cache cooldown.
     */
    private function shouldSendAlert(string $cacheKey, string $pipelineFlagColumn): bool
    {
        $active = DailyPipelineRun::query()
            ->whereIn('status', ['pending', 'discovering', 'scanning', 'submitting'])
            ->orderByDesc('id')
            ->first();

        if ($active !== null) {
            if ($active->{$pipelineFlagColumn} !== null) {
                return false;
            }
            $active->update([$pipelineFlagColumn => now()]);

            return true;
        }

        return Cache::add("pipeline.telegram.{$cacheKey}", 1, now()->addMinutes(15));
    }

    private function shouldStartToday(ProjectSetting $settings, Carbon $now): bool
    {
        $start = $this->todayAt($settings->pipeline_start_time ?: '09:00', $now);
        $deadline = $this->todayAt($settings->pipeline_deadline_time ?: '18:00', $now);

        if ($now->lt($start) || $now->gte($deadline)) {
            return false;
        }

        return ! DailyPipelineRun::query()
            ->whereDate('run_date', $now->toDateString())
            ->exists();
    }

    private function startFromSettings(ProjectSetting $settings, Carbon $now): DailyPipelineRun
    {
        if (! $settings->pipeline_region_id) {
            throw new \RuntimeException('В настройках автопайплайна не выбран регион');
        }

        return $this->create([
            'region_id' => (int) $settings->pipeline_region_id,
            'query' => $settings->pipeline_query_template,
            'max_pages' => (int) ($settings->pipeline_max_pages ?? 3),
            'timezone' => $settings->pipeline_timezone ?: 'Europe/Moscow',
            'start_time' => $settings->pipeline_start_time ?: '09:00',
            'deadline_time' => $settings->pipeline_deadline_time ?: '18:00',
        ]);
    }

    private function advance(DailyPipelineRun $pipeline, ProjectSetting $settings): void
    {
        match ($pipeline->status) {
            'discovering' => $this->advanceDiscovery($pipeline, $settings),
            'scanning' => $this->advanceScanning($pipeline, $settings),
            'submitting' => $this->advanceSubmitting($pipeline, $settings),
            default => null,
        };
    }

    private function advanceDiscovery(DailyPipelineRun $pipeline, ProjectSetting $settings): void
    {
        $discovery = $pipeline->discoveryRun;
        if ($discovery === null) {
            $this->finalize($pipeline, 'failed', 'Нет связанного прогона поиска');

            return;
        }

        if (in_array($discovery->status, ['queued', 'processing'], true)) {
            return;
        }

        if ($discovery->status === 'failed' || $discovery->blocked) {
            $error = (string) ($discovery->error_message ?: 'Прогон поиска завершился с ошибкой');
            if (self::isFatalCaptchaError($error)) {
                $this->notifyCaptchaFailure($error);
            }
            $pipeline->update([
                'promo_sites_count' => (int) $discovery->found_count,
                'new_sites_count' => (int) $discovery->new_sites_count,
                'discovery_finished_at' => now(),
            ]);
            $this->finalize($pipeline, 'failed', $error);

            return;
        }

        $pipeline->update([
            'promo_sites_count' => (int) $discovery->found_count,
            'new_sites_count' => (int) $discovery->new_sites_count,
            'discovery_finished_at' => now(),
        ]);

        if (! $pipeline->scan_forms) {
            // Always on — keep branch only for old rows.
            $pipeline->update(['scan_forms' => true]);
        }

        try {
            $queued = $this->enqueueFormScans($pipeline);
        } catch (Throwable $e) {
            if (str_contains(strtolower($e->getMessage()), 'proxy')) {
                $this->notifyNoProxy($e->getMessage());
            }
            $this->finalize($pipeline, 'failed', $e->getMessage());

            return;
        }

        $pipeline->update([
            'scan_queued_count' => $queued,
            'status' => 'scanning',
        ]);

        if ($queued === 0) {
            $this->finishScanStage($pipeline, $settings);
        }
    }

    private function advanceScanning(DailyPipelineRun $pipeline, ProjectSetting $settings): void
    {
        $siteIds = $this->pipelineSiteIds($pipeline);
        if ($siteIds === []) {
            $this->finishScanStage($pipeline, $settings);

            return;
        }

        $pending = BotTask::query()
            ->where('type', 'scan_form')
            ->whereIn('site_id', $siteIds)
            ->whereIn('status', ['queued', 'processing'])
            ->exists();

        if ($pending) {
            return;
        }

        // Tasks done but site left as «scanning» (e.g. webhook 500) — unblock stage.
        Site::query()
            ->whereIn('id', $siteIds)
            ->where('status', 'scanning')
            ->each(function (Site $site): void {
                $hasActive = $site->formMappings()->where('status', 'active')->exists();
                $site->update([
                    'status' => $hasActive ? 'ready' : 'needs_manual_mapping',
                    'last_scan_at' => $site->last_scan_at ?? now(),
                ]);
            });

        $this->finishScanStage($pipeline, $settings);
    }

    private function finishScanStage(DailyPipelineRun $pipeline, ProjectSetting $settings): void
    {
        $siteIds = $this->pipelineSiteIds($pipeline);
        $sites = Site::query()->whereIn('id', $siteIds)->get();

        $formsFound = $sites->filter(
            fn (Site $site): bool => $site->status === 'ready'
                && $site->formMappings()->where('status', 'active')->exists(),
        )->count();

        $notFound = [];
        foreach ($sites as $site) {
            $hasActive = $site->formMappings()->where('status', 'active')->exists();
            if ($hasActive && $site->status === 'ready') {
                continue;
            }
            $notFound[] = [
                'site_id' => $site->id,
                'url' => $site->url,
                'status' => $site->status,
                'note' => $hasActive ? 'есть маппинг, статус не ready' : 'форма не найдена / ошибка скана',
            ];
        }

        $pipeline->update([
            'forms_found_count' => $formsFound,
            'forms_not_found_count' => count($notFound),
            'scan_finished_at' => now(),
            'report' => array_merge($pipeline->report ?? [], ['forms_missing' => $notFound]),
        ]);

        $this->maybeStartSubmitOrFinish($pipeline, $settings);
    }

    private function maybeStartSubmitOrFinish(DailyPipelineRun $pipeline, ProjectSetting $settings): void
    {
        // Отправка всегда включена: крутится по сайтам 1→N→1… до дедлайна.
        $pipeline->update([
            'submit_forms' => true,
            'submit_cycles_planned' => 0,
            'submit_cycle_current' => 0,
            'status' => 'submitting',
        ]);

        $this->startNextSubmitLap($pipeline, $settings);
    }

    private function startNextSubmitLap(DailyPipelineRun $pipeline, ProjectSetting $settings): void
    {
        $pipeline->refresh();

        if ($this->isPastDeadline($pipeline)) {
            $pipeline->update(['submit_finished_at' => now()]);
            $this->finalize($pipeline, 'completed', 'Достигнут дедлайн отправки');

            return;
        }

        $next = (int) $pipeline->submit_cycle_current + 1;

        try {
            $queued = $this->enqueueSubmitCampaign($pipeline, $settings, $next);
        } catch (Throwable $e) {
            if (str_contains($e->getMessage(), 'proxy')) {
                $this->notifyNoProxy($e->getMessage());
            }
            $this->finalize($pipeline, 'failed', $e->getMessage());

            return;
        }

        $pipeline->update([
            'submit_cycle_current' => $next,
            'submit_queued_count' => (int) $pipeline->submit_queued_count + $queued,
            'status' => 'submitting',
        ]);

        if ($queued === 0) {
            $pipeline->update(['submit_finished_at' => now()]);
            $this->finalize($pipeline, 'completed', 'Нет сайтов с активной формой для отправки');
        }
    }

    private function advanceSubmitting(DailyPipelineRun $pipeline, ProjectSetting $settings): void
    {
        $campaign = $pipeline->campaign;
        if ($campaign === null) {
            $this->finalize($pipeline, 'failed', 'Нет кампании отправки');

            return;
        }

        if (in_array($campaign->status, ['queued', 'processing', 'draft'], true)) {
            return;
        }

        $report = $pipeline->report ?? [];
        $counted = $report['counted_campaign_ids'] ?? [];
        if (! in_array($campaign->id, $counted, true)) {
            $counted[] = $campaign->id;
            $pipeline->update([
                'submit_success_count' => (int) $pipeline->submit_success_count + (int) $campaign->success_count,
                'submit_failed_count' => (int) $pipeline->submit_failed_count + (int) $campaign->failed_count,
                'submit_unknown_count' => (int) $pipeline->submit_unknown_count + (int) $campaign->unknown_count,
                'report' => array_merge($report, ['counted_campaign_ids' => $counted]),
            ]);
        }

        if (! in_array($campaign->status, ['completed', 'completed_with_errors', 'cancelled'], true)) {
            $this->finalize($pipeline, 'failed', 'Кампания: '.$campaign->status);

            return;
        }

        // Следующий круг по тем же сайтам, пока не дедлайн.
        if ($this->isPastDeadline($pipeline)) {
            $pipeline->update(['submit_finished_at' => now()]);
            $this->finalize($pipeline, 'completed', 'Достигнут дедлайн отправки');

            return;
        }

        $this->startNextSubmitLap($pipeline, $settings);
    }

    private function isPastDeadline(DailyPipelineRun $pipeline): bool
    {
        if ($pipeline->deadline_at === null) {
            return false;
        }

        $tz = (string) ($pipeline->timezone ?: 'Europe/Moscow');

        return Carbon::now($tz)->greaterThanOrEqualTo($pipeline->deadline_at);
    }

    /**
     * @return list<int>
     */
    private function pipelineSiteIds(DailyPipelineRun $pipeline): array
    {
        if ($pipeline->discovery_run_id === null) {
            return [];
        }

        return Site::query()
            ->where('discovery_run_id', $pipeline->discovery_run_id)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    private function enqueueFormScans(DailyPipelineRun $pipeline): int
    {
        if ($pipeline->discovery_run_id === null) {
            return 0;
        }

        if (ProxyPicker::pick() === null) {
            $this->notifyNoProxy('Скан форм отменён.');

            throw new \RuntimeException('Нет доступного proxy');
        }

        $settings = ProjectSetting::query()->firstOrCreate([]);

        $sites = Site::query()
            ->where('discovery_run_id', $pipeline->discovery_run_id)
            ->whereDoesntHave('formMappings')
            ->whereIn('status', ['new', 'needs_manual_mapping', 'mapping_failed'])
            ->get();

        $queued = 0;

        foreach ($sites as $site) {
            $already = BotTask::query()
                ->where('type', 'scan_form')
                ->where('site_id', $site->id)
                ->whereIn('status', ['queued', 'processing'])
                ->exists();

            if ($already) {
                continue;
            }

            $proxy = ProxyPicker::pick();
            if ($proxy === null) {
                $this->notifyNoProxy("Скан форм остановлен на сайте #{$site->id}.");

                break;
            }

            $site->update(['status' => 'scanning']);

            $task = BotTask::query()->create([
                'type' => 'scan_form',
                'status' => 'queued',
                'site_id' => $site->id,
                'payload' => [
                    'taskId' => null,
                    'siteId' => $site->id,
                    'url' => $site->url,
                    'pipelineRunId' => $pipeline->id,
                    'maxFormMappings' => max(1, min(10, (int) ($settings->max_form_mappings_per_site ?? 5))),
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

            $queued++;
        }

        return $queued;
    }

    private function enqueueSubmitCampaign(DailyPipelineRun $pipeline, ProjectSetting $settings, int $cycle): int
    {
        $siteIds = $this->pipelineSiteIds($pipeline);
        if ($siteIds === []) {
            return 0;
        }

        $sites = Site::query()
            ->whereIn('id', $siteIds)
            ->where('status', 'ready')
            ->whereHas('formMappings', fn ($q) => $q->where('status', 'active'))
            ->orderBy('id')
            ->get();

        if ($sites->isEmpty()) {
            return 0;
        }

        $useProxy = true;
        $proxy = ProxyPicker::pick();

        if ($proxy === null) {
            throw new \RuntimeException('proxy_required_but_not_available');
        }

        $campaign = Campaign::query()->create([
            'name' => "Автопайплайн #{$pipeline->id} круг {$cycle}: {$pipeline->query}",
            'phone' => '0000000000',
            'source' => 'web',
            'status' => 'queued',
            'total_sites' => $sites->count(),
            'telegram_chat_id' => $settings->pipeline_telegram_chat_id,
        ]);

        $pipeline->update(['campaign_id' => $campaign->id]);

        $queued = 0;

        foreach ($sites as $site) {
            $mapping = SubmitLeadPayloadBuilder::pickMapping($site);
            if ($mapping === null) {
                continue;
            }

            try {
                $identity = $this->identityGenerator->generateForSite($site);
            } catch (Throwable $e) {
                Log::warning('pipeline.identity_failed', ['site_id' => $site->id, 'error' => $e->getMessage()]);

                continue;
            }

            $siteProxy = ProxyPicker::pick() ?? $proxy;
            if ($siteProxy === null) {
                $this->notifyNoProxy("Сайт #{$site->id} пропущен при отправке.");

                continue;
            }

            if ($campaign->phone === '0000000000') {
                $campaign->update(['phone' => $identity['phone']]);
            }

            $run = CampaignSiteRun::query()->create([
                'campaign_id' => $campaign->id,
                'site_id' => $site->id,
                'proxy_id' => $siteProxy->id,
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
                    'phone' => $identity['phone'],
                    'region' => SubmitLeadPayloadBuilder::regionArray($site),
                    'screenshotConfig' => [
                        'enabled' => false,
                    ],
                    'mapping' => SubmitLeadPayloadBuilder::mappingArray($mapping),
                    'proxy' => ProxyPicker::toPayload($siteProxy),
                    'proxyConfig' => ProxyPicker::configFromSettings($settings),
                    'pipelineRunId' => $pipeline->id,
                    'pipelineCycle' => $cycle,
                ],
            ]);

            $task->update([
                'payload' => [
                    ...($task->payload ?? []),
                    'taskId' => $task->id,
                ],
            ]);

            ProxyPicker::markUsed($siteProxy);

            $queued++;
        }

        if ($queued === 0) {
            $campaign->update([
                'status' => 'completed',
                'finished_at' => now(),
                'total_sites' => 0,
            ]);
        } else {
            $campaign->update([
                'status' => 'processing',
                'started_at' => now(),
                'total_sites' => $queued,
            ]);
        }

        return $queued;
    }

    private function cancelRelatedWork(DailyPipelineRun $pipeline): void
    {
        if ($pipeline->discovery_run_id) {
            $discovery = $pipeline->discoveryRun;
            if ($discovery && $discovery->bot_task_id) {
                BotTask::query()
                    ->where('id', $discovery->bot_task_id)
                    ->where('status', 'queued')
                    ->update([
                        'status' => 'failed',
                        'error_message' => 'Отменено: остановка автопайплайна',
                        'finished_at' => now(),
                    ]);
            }
            if ($discovery && in_array($discovery->status, ['queued', 'processing'], true)) {
                $discovery->update([
                    'status' => 'failed',
                    'error_message' => 'Отменено: остановка автопайплайна',
                    'finished_at' => now(),
                ]);
            }
        }

        $siteIds = $this->pipelineSiteIds($pipeline);
        if ($siteIds !== []) {
            BotTask::query()
                ->where('type', 'scan_form')
                ->whereIn('site_id', $siteIds)
                ->where('status', 'queued')
                ->delete();

            Site::query()
                ->whereIn('id', $siteIds)
                ->where('status', 'scanning')
                ->update(['status' => 'new']);
        }

        if ($pipeline->campaign_id) {
            $campaign = Campaign::query()->find($pipeline->campaign_id);
            if ($campaign && in_array($campaign->status, ['queued', 'processing'], true)) {
                $runIds = $campaign->runs()->pluck('id');
                BotTask::query()
                    ->whereIn('campaign_site_run_id', $runIds)
                    ->where('status', 'queued')
                    ->delete();
                CampaignSiteRun::query()
                    ->where('campaign_id', $campaign->id)
                    ->where('status', 'pending')
                    ->update([
                        'status' => 'skipped',
                        'skip_reason' => 'pipeline_cancelled',
                        'finished_at' => now(),
                    ]);
                $campaign->update([
                    'status' => 'cancelled',
                    'finished_at' => now(),
                ]);
            }
        }
    }

    private function finalize(DailyPipelineRun $pipeline, string $status, ?string $error): void
    {
        $pipeline->refresh();

        if (! $pipeline->isActive() && $pipeline->finished_at !== null) {
            return;
        }

        $pipeline->status = $status;
        $pipeline->error_message = $error;
        $pipeline->finished_at = now();
        $pipeline->save();

        $this->sendSummary($pipeline);

        Log::info('pipeline.finished', [
            'id' => $pipeline->id,
            'status' => $status,
            'error' => $error,
        ]);
    }

    private function sendSummary(DailyPipelineRun $pipeline): void
    {
        if ($pipeline->summary_sent_at !== null) {
            return;
        }

        $settings = ProjectSetting::query()->firstOrCreate([]);
        $regionName = $pipeline->region?->name ?? '—';

        $title = match ($pipeline->status) {
            'completed' => '✅ Автопайплайн завершён успешно',
            'failed' => '❌ Автопайплайн упал',
            'timeout' => '⏰ Автопайплайн: дедлайн',
            'cancelled' => '🛑 Автопайплайн остановлен',
            default => '📊 Автопайплайн',
        };

        $lines = [
            "{$title} #{$pipeline->id}",
            "Регион: {$regionName}",
            "Запрос: {$pipeline->query}",
            'Статус: '.$pipeline->statusLabel().' · '.$pipeline->stageLabel(),
            '',
            "1) Промо-сайтов: {$pipeline->promo_sites_count} (новых: {$pipeline->new_sites_count})",
            "2) Формы: найдено {$pipeline->forms_found_count}, без формы {$pipeline->forms_not_found_count}",
            "3) Отправки: кругов {$pipeline->submit_cycle_current} | ✅ {$pipeline->submit_success_count} | ❌ {$pipeline->submit_failed_count} | ❓ {$pipeline->submit_unknown_count}",
        ];

        if ($pipeline->error_message) {
            $lines[] = '';
            $lines[] = 'Комментарий: '.$pipeline->error_message;
        }

        if ($this->alert($settings, implode("\n", $lines))) {
            $pipeline->update(['summary_sent_at' => now()]);
        }
    }

    private function alert(ProjectSetting $settings, string $text): bool
    {
        $chatId = trim((string) ($settings->pipeline_telegram_chat_id ?? ''));
        if ($chatId === '') {
            Log::warning('telegram.pipeline_chat_id_missing', [
                'preview' => mb_substr($text, 0, 200),
            ]);

            return false;
        }

        $sent = $this->telegram->sendMessage($chatId, $text);
        if (! $sent) {
            Log::warning('telegram.pipeline_alert_failed', [
                'chat_id' => $chatId,
                'preview' => mb_substr($text, 0, 200),
            ]);
        }

        return $sent;
    }

    private function pickProxy(): ?Proxy
    {
        return ProxyPicker::pick();
    }

    private function todayAt(string $hm, Carbon $now): Carbon
    {
        [$h, $m] = array_pad(explode(':', $hm), 2, '0');

        return $now->copy()->setTime((int) $h, (int) $m, 0);
    }

    private function resolveDeadline(string $deadlineTime, Carbon $now): Carbon
    {
        $deadline = $this->todayAt($deadlineTime, $now);
        if ($now->greaterThanOrEqualTo($deadline)) {
            $deadline->addDay();
        }

        return $deadline;
    }
}
