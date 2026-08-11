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
use App\Support\RuntimeSettings;
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

        // Activate scheduled pending runs whose start time has arrived.
        $this->activateDuePendingPipelines($settings);

        $actives = DailyPipelineRun::query()
            ->whereIn('status', ['pending', 'discovering', 'scanning', 'submitting'])
            ->orderBy('id')
            ->get();

        foreach ($actives as $active) {
            $tz = (string) ($active->timezone ?: 'Europe/Moscow');
            $now = Carbon::now($tz);

            if ($active->status === 'pending') {
                // Still waiting for scheduled_start_at (handled above) or missing start.
                continue;
            }

            if ($active->deadline_at !== null && $now->greaterThanOrEqualTo($active->deadline_at)) {
                $this->cancelRelatedWork($active);
                $this->finalize($active, 'timeout', 'Достигнут дедлайн '.($active->deadline_time ?: $active->deadline_at->format('d.m H:i')));

                continue;
            }

            if ($active->use_proxy && $this->pickProxy() === null) {
                $this->pausePipelineForNoProxy($active);

                continue;
            }

            $this->refreshFormStats($active);
            try {
                $this->advance($active->fresh() ?? $active, $settings);
            } catch (Throwable $e) {
                if ($this->isNoProxyError($e)) {
                    $this->pausePipelineForNoProxy($active->fresh() ?? $active);

                    continue;
                }
                throw $e;
            }
            if ($active->fresh()?->isActive()) {
                $this->refreshFormStats($active->fresh());
            }
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
            'source' => 'discovery',
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

    /**
     * Create pipeline from existing sites and/or pasted domains (skip Yandex discovery).
     *
     * @param  array{
     *   region_id?:int|null,
     *   mode?:'scan_only'|'submit_only'|'scan_and_submit',
     *   site_ids?:list<int>|null,
     *   domains_text?:string|null,
     *   timezone?:string,
     *   scheduled_start_at?:string|\DateTimeInterface|null,
     *   deadline_at?:string|\DateTimeInterface|null,
     * }  $data
     */
    public function createFromSites(array $data): DailyPipelineRun
    {
        $mode = $this->normalizeMode($data['mode'] ?? 'scan_and_submit');
        $tz = (string) ($data['timezone'] ?? 'Europe/Moscow');
        $now = Carbon::now($tz);

        $region = null;
        if (! empty($data['region_id'])) {
            $region = Region::query()->find((int) $data['region_id']);
        }

        $siteIds = $this->resolveSiteIdsFromInput(
            $region,
            is_array($data['site_ids'] ?? null) ? $data['site_ids'] : [],
            is_string($data['domains_text'] ?? null) ? $data['domains_text'] : '',
        );

        if ($siteIds === []) {
            throw new \RuntimeException('Не удалось определить ни одного сайта. Укажите список или вставьте домены.');
        }

        // Prefer first site's region for display when multi-region selection.
        if ($region === null) {
            $firstRegionId = Site::query()->whereIn('id', $siteIds)->whereNotNull('region_id')->value('region_id');
            $region = $firstRegionId ? Region::query()->find((int) $firstRegionId) : null;
        }

        $scanForms = $mode !== 'submit_only';
        $submitForms = $mode !== 'scan_only';
        $label = match ($mode) {
            'scan_only' => 'скан форм',
            'submit_only' => 'отправка форм',
            default => 'скан + отправка',
        };

        [$scheduledStartAt, $deadlineAt, $deadlineTime, $startTime] = $this->resolveScheduleWindow($data, $now, $tz);
        $deferStart = $scheduledStartAt !== null && $scheduledStartAt->greaterThan($now);

        $pipeline = DailyPipelineRun::query()->create([
            'run_date' => ($scheduledStartAt ?? $now)->toDateString(),
            'status' => 'pending',
            'region_id' => $region?->id,
            'query' => 'Список сайтов ('.$label.'): '.count($siteIds).' шт.',
            'max_pages' => 1,
            'use_proxy' => true,
            'scan_forms' => $scanForms,
            'submit_forms' => $submitForms,
            'submit_cycles_min' => 1,
            'submit_cycles_max' => 1,
            'submit_cycles_planned' => 0,
            'submit_cycle_current' => 0,
            'timezone' => $tz,
            'start_time' => $startTime,
            'deadline_time' => $deadlineTime,
            'started_at' => null,
            'scheduled_start_at' => $scheduledStartAt,
            'deadline_at' => $deadlineAt,
            'discovery_run_id' => null,
            'discovery_finished_at' => now(),
            'scan_finished_at' => $scanForms ? null : now(),
            'site_ids' => $siteIds,
            'source' => 'sites',
            'new_sites_count' => count($siteIds),
            'promo_sites_count' => 0,
            'manual_stop' => false,
            'pause_reason' => null,
        ]);

        $this->refreshFormStats($pipeline);

        if ($deferStart) {
            Log::info('pipeline.scheduled_from_sites', [
                'id' => $pipeline->id,
                'sites' => count($siteIds),
                'mode' => $mode,
                'scheduled_start_at' => $scheduledStartAt?->toIso8601String(),
                'deadline_at' => $deadlineAt?->toIso8601String(),
            ]);

            return $pipeline->fresh();
        }

        return $this->beginSitesPipelineWork($pipeline->fresh());
    }

    /**
     * Activate a sites/discovery pipeline that is pending or paused (internal).
     */
    public function beginSitesPipelineWork(DailyPipelineRun $pipeline): DailyPipelineRun
    {
        $pipeline->refresh();
        $settings = ProjectSetting::query()->firstOrCreate([]);
        $mode = $this->modeFromFlags($pipeline);

        if ($pipeline->use_proxy && $this->pickProxy() === null) {
            $this->notifyNoProxy("Пайплайн #{$pipeline->id}: нет прокси — пауза.");
            $this->pausePipelineForNoProxy($pipeline);

            return $pipeline->fresh();
        }

        $scanForms = (bool) $pipeline->scan_forms;
        $pipeline->update([
            'status' => $scanForms ? 'scanning' : 'submitting',
            'started_at' => $pipeline->started_at ?? now(),
            'finished_at' => null,
            'error_message' => null,
            'pause_reason' => null,
            'manual_stop' => false,
            'alert_no_proxy_sent_at' => null,
        ]);

        $pipeline = $pipeline->fresh();
        $this->refreshFormStats($pipeline);

        if (! $scanForms) {
            try {
                $this->startNextSubmitLap($pipeline, $settings);
            } catch (Throwable $e) {
                if ($this->isNoProxyError($e)) {
                    $this->pausePipelineForNoProxy($pipeline);

                    return $pipeline->fresh();
                }
                $this->finalize($pipeline, 'failed', $e->getMessage());

                throw $e;
            }

            Log::info('pipeline.sites_work_started', [
                'id' => $pipeline->id,
                'mode' => $mode,
                'scan_queued' => 0,
            ]);

            return $pipeline->fresh();
        }

        try {
            $queued = $this->enqueueFormScans($pipeline);
        } catch (Throwable $e) {
            if ($this->isNoProxyError($e)) {
                $this->pausePipelineForNoProxy($pipeline);

                return $pipeline->fresh();
            }
            $this->finalize($pipeline, 'failed', $e->getMessage());

            throw $e;
        }

        $pipeline->update(['scan_queued_count' => (int) $pipeline->scan_queued_count + $queued]);

        if ($queued === 0) {
            $this->finishScanStage($pipeline->fresh(), $settings);
        }

        Log::info('pipeline.sites_work_started', [
            'id' => $pipeline->id,
            'mode' => $mode,
            'scan_queued' => $queued,
        ]);

        return $pipeline->fresh();
    }

    /**
     * Start / restart a stopped pipeline: scan only, submit only, or scan + submit.
     *
     * @param  'scan_only'|'submit_only'|'scan_and_submit'  $mode
     */
    public function start(DailyPipelineRun $pipeline, string $mode = 'scan_and_submit'): DailyPipelineRun
    {
        $mode = $this->normalizeMode($mode);

        if ($pipeline->isActive()) {
            throw new \RuntimeException('Пайплайн уже запущен');
        }

        $siteIds = $this->siteIdsFor($pipeline);
        if ($siteIds === []) {
            throw new \RuntimeException('У пайплайна нет списка сайтов');
        }

        if ($this->pickProxy() === null) {
            $this->notifyNoProxy('Запуск автопайплайна отменён.');
            if ($pipeline->isPausedNoProxy() || $pipeline->status === 'pending') {
                $this->pausePipelineForNoProxy($pipeline);

                return $pipeline->fresh();
            }

            throw new \RuntimeException('Нет доступного proxy');
        }

        $settings = ProjectSetting::query()->firstOrCreate([]);
        $scanForms = $mode !== 'submit_only';
        $submitForms = $mode !== 'scan_only';

        $pipeline->update([
            'status' => $scanForms ? 'scanning' : 'submitting',
            'scan_forms' => $scanForms,
            'submit_forms' => $submitForms,
            'error_message' => null,
            'finished_at' => null,
            'submit_finished_at' => null,
            'alert_no_proxy_sent_at' => null,
            'pause_reason' => null,
            'manual_stop' => false,
            'scan_finished_at' => $scanForms ? null : ($pipeline->scan_finished_at ?? now()),
            'started_at' => $pipeline->started_at ?? now(),
        ]);

        $pipeline = $pipeline->fresh();
        $this->refreshFormStats($pipeline);

        if (! $scanForms) {
            $readyCount = Site::query()
                ->whereIn('id', $siteIds)
                ->where('status', 'ready')
                ->whereHas('formMappings', fn ($q) => $q->where('status', 'active'))
                ->count();

            if ($readyCount === 0) {
                throw new \RuntimeException('Нет сайтов со статусом ready и активной формой');
            }

            $this->startNextSubmitLap($pipeline->fresh(), $settings);

            Log::info('pipeline.start', ['id' => $pipeline->id, 'mode' => $mode]);

            return $pipeline->fresh();
        }

        try {
            $queued = $this->enqueueFormScans($pipeline);
        } catch (Throwable $e) {
            if ($this->isNoProxyError($e)) {
                $this->pausePipelineForNoProxy($pipeline);

                return $pipeline->fresh();
            }
            $this->finalize($pipeline, 'failed', $e->getMessage());

            throw $e;
        }

        $pipeline->update([
            'scan_queued_count' => (int) $pipeline->scan_queued_count + $queued,
            'status' => 'scanning',
        ]);

        if ($queued === 0) {
            $this->finishScanStage($pipeline->fresh(), $settings);
        }

        Log::info('pipeline.start', [
            'id' => $pipeline->id,
            'mode' => $mode,
            'scan_queued' => $queued,
        ]);

        return $pipeline->fresh();
    }

    /**
     * Recalculate forms_found / forms_not_found from current site mappings.
     * Safe to call while pipeline is running or after manual mapping.
     */
    public function refreshFormStats(DailyPipelineRun $pipeline): DailyPipelineRun
    {
        $siteIds = $this->siteIdsFor($pipeline);
        if ($siteIds === []) {
            return $pipeline;
        }

        $sites = Site::query()
            ->whereIn('id', $siteIds)
            ->with(['formMappings' => fn ($q) => $q->where('status', 'active')])
            ->get();

        $formsFound = 0;
        $notFound = [];

        foreach ($sites as $site) {
            $hasActive = $site->formMappings->isNotEmpty();
            if ($hasActive && $site->status === 'ready') {
                $formsFound++;

                continue;
            }

            $notFound[] = [
                'site_id' => $site->id,
                'url' => $site->url,
                'status' => $site->status,
                'note' => $hasActive ? 'есть маппинг, статус не ready' : 'форма не найдена / ошибка скана',
            ];
        }

        $payload = [
            'forms_found_count' => $formsFound,
            'forms_not_found_count' => count($notFound),
            'report' => array_merge($pipeline->report ?? [], [
                'forms_missing' => $notFound,
                'sites_count' => count($siteIds),
            ]),
        ];

        if (($pipeline->source ?? '') === 'sites') {
            $payload['new_sites_count'] = count($siteIds);
        }

        $changed = (int) $pipeline->forms_found_count !== $formsFound
            || (int) $pipeline->forms_not_found_count !== count($notFound)
            || (($pipeline->report['sites_count'] ?? null) !== count($siteIds));

        if ($changed || (($pipeline->source ?? '') === 'sites' && (int) $pipeline->new_sites_count !== count($siteIds))) {
            $pipeline->update($payload);
        }

        return $pipeline->fresh() ?? $pipeline;
    }

    /**
     * After manual form mapping — update every pipeline that includes this site.
     */
    public function refreshPipelinesContainingSite(int $siteId): void
    {
        $site = Site::query()->find($siteId);
        if ($site === null) {
            return;
        }

        $seen = [];

        if ($site->discovery_run_id !== null) {
            DailyPipelineRun::query()
                ->where('discovery_run_id', $site->discovery_run_id)
                ->orderByDesc('id')
                ->limit(50)
                ->get()
                ->each(function (DailyPipelineRun $pipeline) use (&$seen): void {
                    $seen[$pipeline->id] = true;
                    $this->refreshFormStats($pipeline);
                });
        }

        DailyPipelineRun::query()
            ->whereNotNull('site_ids')
            ->orderByDesc('id')
            ->limit(200)
            ->get()
            ->each(function (DailyPipelineRun $pipeline) use ($siteId, &$seen): void {
                if (isset($seen[$pipeline->id])) {
                    return;
                }
                if (! in_array($siteId, $this->siteIdsFor($pipeline), true)) {
                    return;
                }
                $this->refreshFormStats($pipeline);
            });
    }

    /**
     * @return list<int>
     */
    public function siteIdsFor(DailyPipelineRun $pipeline): array
    {
        return $this->pipelineSiteIds($pipeline);
    }

    /**
     * Campaign IDs created by this pipeline across all submit laps.
     *
     * @return list<int>
     */
    public function campaignIdsFor(DailyPipelineRun $pipeline): array
    {
        $ids = [];

        if ($pipeline->campaign_id) {
            $ids[(int) $pipeline->campaign_id] = (int) $pipeline->campaign_id;
        }

        foreach (['all_campaign_ids', 'counted_campaign_ids'] as $key) {
            foreach ($pipeline->report[$key] ?? [] as $id) {
                $id = (int) $id;
                if ($id > 0) {
                    $ids[$id] = $id;
                }
            }
        }

        Campaign::query()
            ->where('name', 'like', 'Автопайплайн #'.$pipeline->id.' %')
            ->pluck('id')
            ->each(function ($id) use (&$ids): void {
                $id = (int) $id;
                if ($id > 0) {
                    $ids[$id] = $id;
                }
            });

        return array_values($ids);
    }

    /**
     * Remember a submit campaign on the pipeline so stop/restart keeps Отправлено/Ошибки.
     */
    public function rememberCampaignId(DailyPipelineRun $pipeline, int $campaignId): void
    {
        if ($campaignId < 1) {
            return;
        }

        $pipeline->refresh();
        $report = is_array($pipeline->report) ? $pipeline->report : [];
        $all = [];
        foreach ($report['all_campaign_ids'] ?? [] as $id) {
            $id = (int) $id;
            if ($id > 0) {
                $all[$id] = $id;
            }
        }
        $all[$campaignId] = $campaignId;

        $pipeline->update([
            'report' => array_merge($report, [
                'all_campaign_ids' => array_values($all),
            ]),
        ]);
    }

    /**
     * Per-site submit counters for the pipeline view table.
     * Live CampaignSiteRun wins; imported sync stats fill gaps (remote report without local campaigns).
     * «Отправлено» = завершённые попытки (success/failed/unknown), без pending/skipped.
     *
     * @return array<int, array{total:int, success:int, failed:int, unknown:int, pending:int}>
     */
    public function submitStatsBySite(DailyPipelineRun $pipeline): array
    {
        $stats = [];

        $imported = $pipeline->report['imported_site_submit_stats'] ?? [];
        if (is_array($imported)) {
            foreach ($imported as $siteId => $row) {
                if (! is_array($row)) {
                    continue;
                }
                $success = (int) ($row['success'] ?? 0);
                $failed = (int) ($row['failed'] ?? 0);
                $unknown = (int) ($row['unknown'] ?? 0);
                $finished = $success + $failed + $unknown;
                $stats[(int) $siteId] = [
                    'total' => $finished > 0 ? $finished : (int) ($row['total'] ?? 0),
                    'success' => $success,
                    'failed' => $failed,
                    'unknown' => $unknown,
                    'pending' => (int) ($row['pending'] ?? 0),
                ];
            }
        }

        $campaignIds = $this->campaignIdsFor($pipeline);
        if ($campaignIds === []) {
            return $stats;
        }

        $rows = CampaignSiteRun::query()
            ->whereIn('campaign_id', $campaignIds)
            ->selectRaw("
                site_id,
                SUM(CASE WHEN status IN ('success', 'failed', 'unknown') THEN 1 ELSE 0 END) as total,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
                SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) as unknown_count,
                SUM(CASE WHEN status IN ('pending', 'processing') THEN 1 ELSE 0 END) as pending_count
            ")
            ->groupBy('site_id')
            ->get();

        foreach ($rows as $row) {
            $siteId = (int) $row->site_id;
            $live = [
                'total' => (int) $row->total,
                'success' => (int) $row->success_count,
                'failed' => (int) $row->failed_count,
                'unknown' => (int) $row->unknown_count,
                'pending' => (int) $row->pending_count,
            ];

            // Don't wipe imported / previous finished stats with a fresh pending-only lap.
            if (
                $live['total'] === 0
                && isset($stats[$siteId])
                && ((int) $stats[$siteId]['total'] > 0 || (int) $stats[$siteId]['failed'] > 0)
            ) {
                $stats[$siteId]['pending'] = $live['pending'];

                continue;
            }

            $stats[$siteId] = $live;
        }

        return $stats;
    }

    /**
     * @return array{start: ?\Carbon\Carbon, end: ?\Carbon\Carbon}
     */
    public function submitTimeRange(DailyPipelineRun $pipeline): array
    {
        $campaignIds = $this->campaignIdsFor($pipeline);
        $tz = (string) ($pipeline->timezone ?: 'Europe/Moscow');

        $start = null;
        $end = null;

        if ($campaignIds !== []) {
            $runStart = CampaignSiteRun::query()
                ->whereIn('campaign_id', $campaignIds)
                ->whereNotNull('started_at')
                ->min('started_at');
            $runEnd = CampaignSiteRun::query()
                ->whereIn('campaign_id', $campaignIds)
                ->whereNotNull('finished_at')
                ->max('finished_at');

            $campaignStart = Campaign::query()
                ->whereIn('id', $campaignIds)
                ->whereNotNull('started_at')
                ->min('started_at');
            $campaignEnd = Campaign::query()
                ->whereIn('id', $campaignIds)
                ->whereNotNull('finished_at')
                ->max('finished_at');

            $startRaw = $runStart ?: $campaignStart;
            $endRaw = $runEnd ?: $campaignEnd;

            if ($startRaw) {
                $start = Carbon::parse($startRaw)->timezone($tz);
            }
            if ($endRaw) {
                $end = Carbon::parse($endRaw)->timezone($tz);
            }
        }

        if ($start === null) {
            $importedStart = $pipeline->report['imported_submit_started_at'] ?? null;
            if (is_string($importedStart) && $importedStart !== '') {
                try {
                    $start = Carbon::parse($importedStart)->timezone($tz);
                } catch (\Throwable) {
                    // ignore bad imported timestamp
                }
            }
        }

        if ($end === null) {
            $importedEnd = $pipeline->report['imported_submit_ended_at'] ?? null;
            if (is_string($importedEnd) && $importedEnd !== '') {
                try {
                    $end = Carbon::parse($importedEnd)->timezone($tz);
                } catch (\Throwable) {
                    // ignore bad imported timestamp
                }
            }
        }

        if ($start === null && $pipeline->scan_finished_at !== null && $pipeline->submit_forms) {
            $start = $pipeline->scan_finished_at->copy()->timezone($tz);
        }

        if ($end === null && $pipeline->submit_finished_at !== null) {
            $end = $pipeline->submit_finished_at->copy()->timezone($tz);
        }

        return ['start' => $start, 'end' => $end];
    }

    /**
     * @return 'scan_only'|'submit_only'|'scan_and_submit'
     */
    private function normalizeMode(mixed $mode): string
    {
        return match ((string) $mode) {
            'scan_only' => 'scan_only',
            'submit_only' => 'submit_only',
            default => 'scan_and_submit',
        };
    }

    /**
     * @return 'scan_only'|'submit_only'|'scan_and_submit'
     */
    private function modeFromFlags(DailyPipelineRun $pipeline): string
    {
        if ($pipeline->scan_forms && $pipeline->submit_forms) {
            return 'scan_and_submit';
        }
        if ($pipeline->scan_forms) {
            return 'scan_only';
        }

        return 'submit_only';
    }

    private function isNoProxyError(Throwable $e): bool
    {
        return stripos($e->getMessage(), 'proxy') !== false
            || stripos($e->getMessage(), 'прокси') !== false;
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{0: ?Carbon, 1: ?Carbon, 2: ?string, 3: string}
     */
    private function resolveScheduleWindow(array $data, Carbon $now, string $tz): array
    {
        $scheduledStartAt = $this->parseFlexibleDateTime($data['scheduled_start_at'] ?? null, $tz);
        $deadlineAt = $this->parseFlexibleDateTime($data['deadline_at'] ?? null, $tz);

        // Legacy: deadline_time "H:i" relative to now / scheduled start.
        if ($deadlineAt === null && ! empty($data['deadline_time'])) {
            $base = $scheduledStartAt?->copy() ?? $now->copy();
            $deadlineAt = $this->resolveDeadline((string) $data['deadline_time'], $base)
                ->copy()
                ->timezone(config('app.timezone'));
        }

        if ($scheduledStartAt === null) {
            $scheduledStartAt = $now->copy()->timezone(config('app.timezone'));
        } else {
            $scheduledStartAt = $scheduledStartAt->copy()->timezone(config('app.timezone'));
        }

        $deadlineTime = $deadlineAt?->copy()->timezone($tz)->format('H:i');
        $startTime = $scheduledStartAt->copy()->timezone($tz)->format('H:i');

        return [$scheduledStartAt, $deadlineAt, $deadlineTime, $startTime];
    }

    private function parseFlexibleDateTime(mixed $value, string $tz): ?Carbon
    {
        if ($value === null || $value === '') {
            return null;
        }

        if ($value instanceof \DateTimeInterface) {
            return Carbon::instance(\DateTimeImmutable::createFromInterface($value))->timezone($tz);
        }

        try {
            return Carbon::parse((string) $value, $tz);
        } catch (Throwable) {
            return null;
        }
    }

    private function activateDuePendingPipelines(ProjectSetting $settings): void
    {
        $due = DailyPipelineRun::query()
            ->where('status', 'pending')
            ->where('manual_stop', false)
            ->whereNotNull('scheduled_start_at')
            ->where('scheduled_start_at', '<=', now())
            ->orderBy('id')
            ->get();

        foreach ($due as $pipeline) {
            if ($pipeline->deadline_at !== null && now()->greaterThanOrEqualTo($pipeline->deadline_at)) {
                $this->finalize($pipeline, 'timeout', 'Дедлайн наступил до старта');

                continue;
            }

            try {
                if (($pipeline->source ?? 'discovery') === 'sites') {
                    $this->beginSitesPipelineWork($pipeline);
                } elseif ($pipeline->discovery_run_id) {
                    // Discovery already queued somehow — move to discovering.
                    $pipeline->update([
                        'status' => 'discovering',
                        'started_at' => $pipeline->started_at ?? now(),
                    ]);
                } else {
                    // Discovery pending without run — start discovery queue if region present.
                    if (! $pipeline->region_id) {
                        $this->finalize($pipeline, 'failed', 'Нет региона для запланированного discovery');

                        continue;
                    }
                    $region = Region::query()->find($pipeline->region_id);
                    if (! $region) {
                        $this->finalize($pipeline, 'failed', 'Регион не найден');

                        continue;
                    }
                    if ($pipeline->use_proxy && $this->pickProxy() === null) {
                        $this->pausePipelineForNoProxy($pipeline);

                        continue;
                    }
                    $queued = $this->discovery->queueRun(
                        $region,
                        (int) $pipeline->max_pages,
                        true,
                        (string) $pipeline->query,
                    );
                    $pipeline->update([
                        'status' => 'discovering',
                        'discovery_run_id' => $queued['run']->id,
                        'started_at' => now(),
                        'pause_reason' => null,
                    ]);
                }
            } catch (Throwable $e) {
                Log::warning('pipeline.activate_pending_failed', [
                    'id' => $pipeline->id,
                    'error' => $e->getMessage(),
                ]);
                if ($this->isNoProxyError($e)) {
                    $this->pausePipelineForNoProxy($pipeline->fresh());
                } else {
                    $this->finalize($pipeline->fresh(), 'failed', $e->getMessage());
                }
            }
        }
    }

    /**
     * @param  list<int|string>  $siteIds
     * @return list<int>
     */
    private function resolveSiteIdsFromInput(?Region $region, array $siteIds, string $domainsText): array
    {
        $resolved = [];

        foreach ($siteIds as $id) {
            $id = (int) $id;
            if ($id > 0 && Site::query()->whereKey($id)->exists()) {
                $resolved[$id] = $id;
            }
        }

        $lines = preg_split('/\R+/u', $domainsText) ?: [];
        foreach ($lines as $line) {
            $line = trim((string) $line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }

            // Allow "domain.ru, other.ru" on one line.
            foreach (preg_split('/[\s,;]+/u', $line) ?: [] as $chunk) {
                $chunk = trim((string) $chunk);
                if ($chunk === '') {
                    continue;
                }

                $url = YandexMapsSiteImporter::normalizeUrl($chunk);
                if ($url === null) {
                    continue;
                }

                $existing = YandexMapsSiteImporter::findByDomain($url);
                if ($existing !== null) {
                    $resolved[$existing->id] = $existing->id;

                    continue;
                }

                if ($region === null) {
                    $host = YandexMapsSiteImporter::normalizeDomain($url) ?? $url;
                    throw new \RuntimeException(
                        "Домен «{$host}» не найден в базе. Для новых доменов укажите регион или сначала добавьте сайт.",
                    );
                }

                $host = YandexMapsSiteImporter::normalizeDomain($url) ?? $url;
                $site = Site::query()->create([
                    'name' => $host,
                    'region_id' => $region->id,
                    'url' => $url,
                    'status' => 'new',
                    'source' => 'manual_pipeline',
                    'discovered_at' => now(),
                ]);
                $resolved[$site->id] = $site->id;
            }
        }

        return array_values($resolved);
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
        if (! $pipeline->isStoppable()) {
            return;
        }

        $this->cancelRelatedWork($pipeline);
        $pipeline->forceFill([
            'manual_stop' => true,
            'pause_reason' => null,
        ])->save();
        $this->finalize($pipeline, 'cancelled', 'Остановлено вручную');
    }

    /**
     * @param  Collection<int, DailyPipelineRun>|iterable<DailyPipelineRun>  $pipelines
     */
    public function stopMany(iterable $pipelines): int
    {
        $count = 0;
        foreach ($pipelines as $pipeline) {
            if ($pipeline->isStoppable()) {
                $this->stop($pipeline);
                $count++;
            }
        }

        return $count;
    }

    public function stopAllActive(): int
    {
        $actives = DailyPipelineRun::query()
            ->whereIn('status', ['pending', 'discovering', 'scanning', 'submitting', 'paused_no_proxy'])
            ->get();

        return $this->stopMany($actives);
    }

    /**
     * Pause running pipelines that require a proxy when none are active.
     */
    public function pauseActivePipelinesForNoProxy(): int
    {
        $actives = DailyPipelineRun::query()
            ->where('use_proxy', true)
            ->whereIn('status', ['discovering', 'scanning', 'submitting'])
            ->get();

        $count = 0;
        foreach ($actives as $pipeline) {
            $this->pausePipelineForNoProxy($pipeline);
            $count++;
        }

        return $count;
    }

    public function pausePipelineForNoProxy(DailyPipelineRun $pipeline): void
    {
        $pipeline->refresh();

        if ($pipeline->manual_stop || in_array($pipeline->status, ['cancelled', 'completed', 'timeout', 'failed'], true)) {
            return;
        }

        if ($pipeline->deadline_at !== null && now()->greaterThanOrEqualTo($pipeline->deadline_at)) {
            $this->cancelRelatedWork($pipeline);
            $this->finalize($pipeline, 'timeout', 'Достигнут дедлайн');

            return;
        }

        if ($pipeline->status === 'paused_no_proxy') {
            return;
        }

        $this->cancelRelatedWork($pipeline);

        $pipeline->forceFill([
            'status' => 'paused_no_proxy',
            'pause_reason' => 'no_proxy',
            'error_message' => 'Нет доступного proxy — пауза до появления рабочих прокси',
            'finished_at' => null,
        ])->save();

        $this->notifyNoProxy("Пайплайн #{$pipeline->id} на паузе: нет рабочих прокси.");

        Log::warning('pipeline.paused_no_proxy', ['id' => $pipeline->id]);
    }

    /**
     * Resume pipelines paused for missing proxies (after health check finds active ones).
     */
    public function resumePausedForProxy(): int
    {
        if ($this->pickProxy() === null) {
            return 0;
        }

        $paused = DailyPipelineRun::query()
            ->where('status', 'paused_no_proxy')
            ->where('manual_stop', false)
            ->orderBy('id')
            ->get();

        $count = 0;
        foreach ($paused as $pipeline) {
            if (! $pipeline->canAutoResume()) {
                if ($pipeline->deadline_at !== null && now()->greaterThanOrEqualTo($pipeline->deadline_at)) {
                    $this->finalize($pipeline, 'timeout', 'Достигнут дедлайн во время паузы');
                }

                continue;
            }

            try {
                if (($pipeline->source ?? 'discovery') === 'sites') {
                    $this->beginSitesPipelineWork($pipeline);
                } else {
                    $this->start($pipeline, $this->modeFromFlags($pipeline));
                }
                $count++;
            } catch (Throwable $e) {
                Log::warning('pipeline.resume_after_proxy_failed', [
                    'id' => $pipeline->id,
                    'error' => $e->getMessage(),
                ]);
                if ($this->isNoProxyError($e)) {
                    $this->pausePipelineForNoProxy($pipeline->fresh());
                }
            }
        }

        return $count;
    }

    /**
     * Resume / continue form-submit stage after fail or manual stop of submitting.
     * Starts the next submit lap (1→N) until manual stop / deadline.
     */
    public function resumeSubmit(DailyPipelineRun $pipeline): DailyPipelineRun
    {
        if ($pipeline->discovery_run_id === null && ($pipeline->site_ids === null || $pipeline->site_ids === [])) {
            throw new \RuntimeException('У пайплайна нет списка сайтов');
        }

        if ($pipeline->scan_finished_at === null && $pipeline->status === 'discovering') {
            throw new \RuntimeException('Сначала нужно завершить поиск и скан форм');
        }

        if ($this->pickProxy() === null) {
            $this->notifyNoProxy('Возобновление отправки отменено.');

            throw new \RuntimeException('Нет доступного proxy');
        }

        $readyCount = Site::query()
            ->whereIn('id', $this->pipelineSiteIds($pipeline))
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

        $laravelKey = RuntimeSettings::captchaApiKey();
        $laravelKeyHint = $laravelKey === ''
            ? '(empty)'
            : (strlen($laravelKey) <= 8
                ? substr($laravelKey, 0, 2).'…(len='.strlen($laravelKey).')'
                : substr($laravelKey, 0, 4).'…'.substr($laravelKey, -4).' (len='.strlen($laravelKey).')');

        Log::error('captcha.fatal', [
            'message' => $message,
            'worker_captcha_key_hint' => $keyFromMessage,
            'laravel_env_captcha_key_hint' => $laravelKeyHint,
            'laravel_env_provider' => RuntimeSettings::captchaProvider(),
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
            if ($this->isNoProxyError($e)) {
                $this->pausePipelineForNoProxy($pipeline);

                return;
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
        $this->refreshFormStats($pipeline);
        $pipeline->update(['scan_finished_at' => now()]);

        $this->maybeStartSubmitOrFinish($pipeline->fresh(), $settings);
    }

    private function maybeStartSubmitOrFinish(DailyPipelineRun $pipeline, ProjectSetting $settings): void
    {
        if (! $pipeline->submit_forms) {
            $this->finalize($pipeline, 'completed', 'Скан форм завершён (без отправки)');

            return;
        }

        // Отправка: крутится по сайтам 1→N→1… до ручной остановки / дедлайна.
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
            if ($this->isNoProxyError($e)) {
                $this->pausePipelineForNoProxy($pipeline);

                return;
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
        $manual = $pipeline->site_ids;
        if (is_array($manual) && $manual !== []) {
            return array_values(array_unique(array_map('intval', $manual)));
        }

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
        $siteIds = $this->pipelineSiteIds($pipeline);
        if ($siteIds === []) {
            return 0;
        }

        if (ProxyPicker::pick() === null) {
            $this->notifyNoProxy('Скан форм отменён.');

            throw new \RuntimeException('Нет доступного proxy');
        }

        $settings = ProjectSetting::query()->firstOrCreate([]);

        $sites = Site::query()
            ->whereIn('id', $siteIds)
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
            ->where(function ($q): void {
                $q->whereNull('submit_heal_status')
                    ->orWhereNotIn('submit_heal_status', [
                        'paused_remap',
                        'rescanning',
                        'testing',
                        'failed_heal',
                    ]);
            })
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
        $this->rememberCampaignId($pipeline, (int) $campaign->id);

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
            if ($campaign) {
                $this->rememberCampaignId($pipeline, (int) $campaign->id);
            }
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

        if ($pipeline->finished_at !== null && ! $pipeline->isStoppable() && ! $pipeline->isPausedNoProxy()) {
            return;
        }

        // Already terminal.
        if (in_array($pipeline->status, ['completed', 'cancelled', 'failed', 'timeout'], true)
            && $pipeline->finished_at !== null
            && $status !== $pipeline->status) {
            return;
        }

        $pipeline->status = $status;
        $pipeline->error_message = $error;
        $pipeline->finished_at = now();
        if ($status === 'cancelled') {
            $pipeline->manual_stop = true;
            $pipeline->pause_reason = null;
        }
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
