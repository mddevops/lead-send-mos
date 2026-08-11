<?php

namespace App\Services;

use App\Models\BotTask;
use App\Models\Campaign;
use App\Models\CampaignSiteRun;
use App\Models\FormMapping;
use App\Models\ProjectSetting;
use App\Models\Site;
use App\Support\ProxyPicker;
use App\Support\SubmitLeadPayloadBuilder;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * After N consecutive submit failures, pause the site in pipeline cycles,
 * rescan for a different form, test-submit it, then resume.
 */
class FormHealService
{
    public const FAIL_STREAK_LIMIT = 3;

    public const STATUS_PAUSED = 'paused_remap';

    public const STATUS_RESCANNING = 'rescanning';

    public const STATUS_TESTING = 'testing';

    public const STATUS_FAILED = 'failed_heal';

    public function isPausedFromSubmit(Site $site): bool
    {
        return in_array($site->submit_heal_status, [
            self::STATUS_PAUSED,
            self::STATUS_RESCANNING,
            self::STATUS_TESTING,
            self::STATUS_FAILED,
        ], true);
    }

    public function recordSubmitOutcome(Site $site, string $runStatus, bool $isProxyFailure = false): void
    {
        if ($isProxyFailure) {
            return;
        }

        // Heal test campaigns handled separately.
        if ($site->submit_heal_status === self::STATUS_TESTING) {
            return;
        }

        if ($runStatus === 'success') {
            if ((int) $site->submit_fail_streak > 0 || $site->submit_heal_status !== null) {
                $site->forceFill([
                    'submit_fail_streak' => 0,
                    'submit_heal_status' => null,
                    'submit_heal_meta' => null,
                ])->save();
            }

            return;
        }

        if (! in_array($runStatus, ['failed', 'unknown'], true)) {
            return;
        }

        if ($this->isPausedFromSubmit($site)) {
            return;
        }

        $streak = (int) $site->submit_fail_streak + 1;
        $site->forceFill(['submit_fail_streak' => $streak])->save();

        if ($streak >= self::FAIL_STREAK_LIMIT) {
            $this->pauseAndRescan($site->fresh());
        }
    }

    public function pauseAndRescan(Site $site): void
    {
        $site->refresh();
        if ($this->isPausedFromSubmit($site) && $site->submit_heal_status !== self::STATUS_FAILED) {
            return;
        }

        $activeMappings = FormMapping::query()
            ->where('site_id', $site->id)
            ->where('status', 'active')
            ->get();

        $exclude = [];
        foreach ($activeMappings as $mapping) {
            $exclude[] = $this->mappingFingerprint($mapping);
            $mapping->update(['status' => 'failed']);
        }

        // Also remember recently failed autos (already failed).
        FormMapping::query()
            ->where('site_id', $site->id)
            ->where('status', 'failed')
            ->orderByDesc('id')
            ->limit(20)
            ->get()
            ->each(function (FormMapping $mapping) use (&$exclude): void {
                $exclude[] = $this->mappingFingerprint($mapping);
            });

        $exclude = array_values(array_unique(array_filter($exclude)));

        $meta = [
            'exclude_fingerprints' => $exclude,
            'failed_mapping_ids' => $activeMappings->pluck('id')->all(),
            'paused_at' => now()->toIso8601String(),
            'reason' => 'submit_fail_streak_'.self::FAIL_STREAK_LIMIT,
        ];

        $site->forceFill([
            'submit_heal_status' => self::STATUS_PAUSED,
            'submit_heal_meta' => $meta,
            'status' => 'scanning',
        ])->save();

        Log::warning('form_heal.paused', [
            'site_id' => $site->id,
            'url' => $site->url,
            'exclude' => count($exclude),
        ]);

        try {
            $this->enqueueHealScan($site->fresh());
        } catch (Throwable $e) {
            Log::error('form_heal.enqueue_scan_failed', [
                'site_id' => $site->id,
                'error' => $e->getMessage(),
            ]);
            $site->forceFill([
                'submit_heal_status' => self::STATUS_FAILED,
                'status' => 'needs_manual_mapping',
            ])->save();
        }
    }

    public function enqueueHealScan(Site $site): BotTask
    {
        $already = BotTask::query()
            ->where('type', 'scan_form')
            ->where('site_id', $site->id)
            ->whereIn('status', ['queued', 'processing'])
            ->exists();

        if ($already) {
            $site->forceFill(['submit_heal_status' => self::STATUS_RESCANNING])->save();

            return BotTask::query()
                ->where('type', 'scan_form')
                ->where('site_id', $site->id)
                ->whereIn('status', ['queued', 'processing'])
                ->latest('id')
                ->firstOrFail();
        }

        $proxy = ProxyPicker::pick();
        if ($proxy === null) {
            throw new \RuntimeException('Нет доступного proxy для heal-скана');
        }

        $settings = ProjectSetting::query()->firstOrCreate([]);
        $meta = is_array($site->submit_heal_meta) ? $site->submit_heal_meta : [];
        $exclude = is_array($meta['exclude_fingerprints'] ?? null) ? $meta['exclude_fingerprints'] : [];

        $task = BotTask::query()->create([
            'type' => 'scan_form',
            'status' => 'queued',
            'site_id' => $site->id,
            'payload' => [
                'taskId' => null,
                'siteId' => $site->id,
                'url' => $site->url,
                'healRemap' => true,
                'excludeFingerprints' => $exclude,
                'maxFormMappings' => max(3, min(10, (int) ($settings->max_form_mappings_per_site ?? 5) + 2)),
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

        $site->forceFill([
            'submit_heal_status' => self::STATUS_RESCANNING,
            'status' => 'scanning',
        ])->save();

        Log::info('form_heal.scan_queued', ['site_id' => $site->id, 'task_id' => $task->id]);

        return $task;
    }

    /**
     * After scan mappings saved — pick a form that differs from excluded ones and test-submit.
     */
    public function afterScanMappingsSaved(Site $site): void
    {
        $site->refresh();
        if ($site->submit_heal_status !== self::STATUS_RESCANNING
            && $site->submit_heal_status !== self::STATUS_PAUSED) {
            return;
        }

        $meta = is_array($site->submit_heal_meta) ? $site->submit_heal_meta : [];
        $exclude = is_array($meta['exclude_fingerprints'] ?? null)
            ? array_map('strval', $meta['exclude_fingerprints'])
            : [];

        $candidates = FormMapping::query()
            ->where('site_id', $site->id)
            ->whereIn('status', ['active', 'draft'])
            ->orderByDesc('confidence')
            ->orderByDesc('id')
            ->get()
            ->filter(function (FormMapping $mapping) use ($exclude): bool {
                $fp = $this->mappingFingerprint($mapping);

                return $fp !== '' && ! in_array($fp, $exclude, true);
            })
            ->values();

        if ($candidates->isEmpty()) {
            Log::warning('form_heal.no_new_form', ['site_id' => $site->id]);
            $site->forceFill([
                'submit_heal_status' => self::STATUS_FAILED,
                'status' => 'needs_manual_mapping',
            ])->save();

            return;
        }

        // Activate only the best new candidate; demote other autos that match exclude.
        FormMapping::query()
            ->where('site_id', $site->id)
            ->where('mapping_type', 'auto')
            ->where('status', 'active')
            ->update(['status' => 'draft']);

        /** @var FormMapping $best */
        $best = $candidates->first();
        $best->update(['status' => 'active']);

        // Keep excluded fingerprints growing if scan re-created near-duplicates as draft.
        foreach ($candidates->skip(1) as $extra) {
            if ($extra->mapping_type === 'auto' && $extra->status === 'active') {
                $extra->update(['status' => 'draft']);
            }
        }

        $site->forceFill([
            'status' => 'ready',
            'submit_heal_status' => self::STATUS_TESTING,
            'submit_heal_meta' => array_merge($meta, [
                'candidate_mapping_id' => $best->id,
                'testing_at' => now()->toIso8601String(),
            ]),
        ])->save();

        try {
            $this->enqueueHealTestSubmit($site->fresh(), $best);
        } catch (Throwable $e) {
            Log::error('form_heal.test_enqueue_failed', [
                'site_id' => $site->id,
                'error' => $e->getMessage(),
            ]);
            $site->forceFill([
                'submit_heal_status' => self::STATUS_FAILED,
                'status' => 'needs_manual_mapping',
            ])->save();
        }
    }

    public function enqueueHealTestSubmit(Site $site, FormMapping $mapping): BotTask
    {
        $proxy = ProxyPicker::pick();
        if ($proxy === null) {
            throw new \RuntimeException('Нет доступного proxy для heal-теста');
        }

        $settings = ProjectSetting::query()->firstOrCreate([]);
        $identity = app(LeadIdentityGenerator::class)->generateForSite($site);

        $campaign = Campaign::query()->create([
            'name' => "Heal тест: {$site->name}",
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
                'healTest' => true,
                'url' => SubmitLeadPayloadBuilder::submitUrl($site, $mapping),
                'name' => $identity['name'],
                'phone' => $identity['phone'],
                'region' => SubmitLeadPayloadBuilder::regionArray($site),
                'screenshotConfig' => ['enabled' => false],
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

        Log::info('form_heal.test_queued', [
            'site_id' => $site->id,
            'mapping_id' => $mapping->id,
            'task_id' => $task->id,
        ]);

        return $task;
    }

    public function recordHealTestOutcome(Site $site, string $runStatus): void
    {
        $site->refresh();
        if ($site->submit_heal_status !== self::STATUS_TESTING) {
            return;
        }

        if ($runStatus === 'success') {
            $site->forceFill([
                'submit_fail_streak' => 0,
                'submit_heal_status' => null,
                'submit_heal_meta' => null,
                'status' => 'ready',
            ])->save();

            Log::info('form_heal.recovered', ['site_id' => $site->id]);

            try {
                app(DailyPipelineService::class)->refreshPipelinesContainingSite((int) $site->id);
            } catch (Throwable $e) {
                Log::warning('form_heal.refresh_pipeline_failed', [
                    'site_id' => $site->id,
                    'error' => $e->getMessage(),
                ]);
            }

            return;
        }

        if (! in_array($runStatus, ['failed', 'unknown'], true)) {
            return;
        }

        // Test failed — mark this candidate failed and try another unused form if any.
        $meta = is_array($site->submit_heal_meta) ? $site->submit_heal_meta : [];
        $candidateId = (int) ($meta['candidate_mapping_id'] ?? 0);
        if ($candidateId > 0) {
            $candidate = FormMapping::query()->find($candidateId);
            if ($candidate) {
                $exclude = is_array($meta['exclude_fingerprints'] ?? null) ? $meta['exclude_fingerprints'] : [];
                $exclude[] = $this->mappingFingerprint($candidate);
                $meta['exclude_fingerprints'] = array_values(array_unique(array_filter($exclude)));
                $candidate->update(['status' => 'failed']);
            }
        }

        $site->forceFill([
            'submit_heal_meta' => $meta,
            'submit_heal_status' => self::STATUS_RESCANNING,
        ])->save();

        $attempts = (int) ($meta['test_attempts'] ?? 0) + 1;
        $meta['test_attempts'] = $attempts;
        $site->forceFill(['submit_heal_meta' => $meta])->save();

        if ($attempts >= 5) {
            Log::warning('form_heal.gave_up', ['site_id' => $site->id, 'attempts' => $attempts]);
            $site->forceFill([
                'submit_heal_status' => self::STATUS_FAILED,
                'status' => 'needs_manual_mapping',
            ])->save();

            return;
        }

        // Try next different draft/active candidate without full rescan first.
        $this->afterScanMappingsSaved($site->fresh());
    }

    public function mappingFingerprint(FormMapping $mapping): string
    {
        $parts = [
            mb_strtolower(trim((string) ($mapping->source_url ?? ''))),
            mb_strtolower(trim((string) ($mapping->open_modal_selector ?? ''))),
            mb_strtolower(trim((string) ($mapping->form_scope_selector ?? ''))),
            mb_strtolower(trim((string) ($mapping->phone_selector ?? ''))),
            mb_strtolower(trim((string) ($mapping->submit_selector ?? ''))),
        ];

        return implode('|', $parts);
    }

    /**
     * Fingerprint compatible with worker DetectedFormMapping.fingerprint filter.
     *
     * @param  array<string, mixed>  $form
     */
    public static function detectedFormFingerprint(array $form): string
    {
        $parts = [
            mb_strtolower(trim((string) ($form['source_url'] ?? ''))),
            mb_strtolower(trim((string) ($form['open_modal_selector'] ?? ''))),
            mb_strtolower(trim((string) ($form['form_scope_selector'] ?? ''))),
            mb_strtolower(trim((string) ($form['phone_selector'] ?? ''))),
            mb_strtolower(trim((string) ($form['submit_selector'] ?? ''))),
        ];

        return implode('|', $parts);
    }
}
