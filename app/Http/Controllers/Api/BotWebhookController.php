<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\BotTask;
use App\Models\CampaignSiteRun;
use App\Models\DailyPipelineRun;
use App\Models\DiscoveryRun;
use App\Models\FormMapping;
use App\Models\ProjectSetting;
use App\Models\Proxy;
use App\Models\Site;
use App\Services\DailyPipelineService;
use App\Services\ProxyHealthChecker;
use App\Services\TelegramNotifier;
use App\Services\YandexAdsDiscoveryService;
use App\Support\RuntimeSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class BotWebhookController extends Controller
{
    public function __construct(
        private readonly TelegramNotifier $telegramNotifier,
    ) {}

    public function runtimeConfig(): JsonResponse
    {
        RuntimeSettings::refresh();

        return response()->json([
            'ok' => true,
            'config' => RuntimeSettings::botRuntimePayload(),
        ]);
    }

    public function claimTask(Request $request): JsonResponse
    {
        $data = $request->validate([
            'worker_id' => ['nullable', 'string', 'max:255'],
            'exclude_types' => ['nullable', 'array'],
            'exclude_types.*' => ['string', 'max:64'],
        ]);

        $excludeTypes = array_values(array_filter(
            array_map('strval', $data['exclude_types'] ?? []),
            fn (string $type): bool => $type !== '',
        ));

        /** @var BotTask|null $botTask */
        $botTask = DB::transaction(function () use ($excludeTypes): ?BotTask {
            /** @var BotTask|null $task */
            $task = BotTask::query()
                ->where('status', 'queued')
                ->when($excludeTypes !== [], fn ($query) => $query->whereNotIn('type', $excludeTypes))
                ->where(function ($query): void {
                    $query->whereNull('campaign_site_run_id')
                        ->orWhereHas('campaignSiteRun.campaign', fn ($campaign) => $campaign->whereNot('status', 'cancelled'));
                })
                ->orderBy('id')
                ->lockForUpdate()
                ->first();

            if (! $task) {
                return null;
            }

            $task->update([
                'status' => 'processing',
                'started_at' => now(),
            ]);

            if ($task->campaign_site_run_id) {
                $task->campaignSiteRun?->update([
                    'status' => 'processing',
                    'started_at' => now(),
                ]);
            }

            if ($task->type === 'discover_yandex_ads') {
                $runId = (int) ($task->payload['discoveryRunId'] ?? 0);
                $run = $runId > 0 ? DiscoveryRun::query()->find($runId) : null;
                $run ??= DiscoveryRun::query()->where('bot_task_id', $task->id)->first();
                $run?->update([
                    'status' => 'processing',
                    'started_at' => now(),
                ]);
            }

            return $task->fresh();
        }, 3);

        if (! $botTask) {
            return response()->json([
                'ok' => true,
                'task' => null,
            ]);
        }

        return response()->json([
            'ok' => true,
            'task' => [
                'taskId' => $botTask->id,
                'type' => $botTask->type,
                'payload' => $botTask->payload ?? [],
            ],
        ]);
    }

    public function taskStarted(Request $request, string $task): JsonResponse
    {
        $data = $request->validate([
            'started_at' => ['nullable', 'date'],
        ]);

        $botTask = $this->resolveTask($task);
        $botTask->update([
            'status' => 'processing',
            'started_at' => $data['started_at'] ?? now(),
        ]);

        if ($botTask->campaign_site_run_id) {
            $botTask->campaignSiteRun?->update([
                'status' => 'processing',
                'started_at' => $data['started_at'] ?? now(),
            ]);
        }

        if ($botTask->type === 'discover_yandex_ads') {
            $runId = (int) ($botTask->payload['discoveryRunId'] ?? 0);
            $run = $runId > 0 ? DiscoveryRun::query()->find($runId) : null;
            $run ??= DiscoveryRun::query()->where('bot_task_id', $botTask->id)->first();

            if ($run) {
                app(YandexAdsDiscoveryService::class)->markProcessing($run);
            }
        }

        return response()->json(['ok' => true]);
    }

    public function taskCompleted(Request $request, string $task): JsonResponse
    {
        $data = $request->validate([
            'finished_at' => ['nullable', 'date'],
            'duration_ms' => ['nullable', 'integer', 'min:0'],
        ]);

        $botTask = $this->resolveTask($task);
        $botTask->update([
            'status' => 'completed',
            'finished_at' => $data['finished_at'] ?? now(),
            'duration_ms' => $data['duration_ms'] ?? null,
        ]);

        if ($botTask->campaign_site_run_id && $botTask->type !== 'submit_lead') {
            $botTask->campaignSiteRun?->update([
                'status' => 'success',
                'finished_at' => $data['finished_at'] ?? now(),
                'duration_ms' => $data['duration_ms'] ?? null,
            ]);
        }

        if (in_array($botTask->type, ['scan_form', 'discover_yandex_ads'], true)) {
            $this->kickPipelineTick();
        }

        return response()->json(['ok' => true]);
    }

    public function taskFailed(Request $request, string $task): JsonResponse
    {
        $data = $request->validate([
            'error_message' => ['nullable', 'string'],
            'finished_at' => ['nullable', 'date'],
            'duration_ms' => ['nullable', 'integer', 'min:0'],
        ]);

        $botTask = $this->resolveTask($task);
        $errorMessage = (string) ($data['error_message'] ?? '');

        $botTask->update([
            'status' => 'failed',
            'error_message' => $data['error_message'] ?? null,
            'finished_at' => $data['finished_at'] ?? now(),
            'duration_ms' => $data['duration_ms'] ?? null,
        ]);

        if ($errorMessage !== '') {
            if (stripos($errorMessage, 'proxy_required') !== false || stripos($errorMessage, 'Нет доступного proxy') !== false) {
                app(DailyPipelineService::class)->notifyNoProxy("Задача #{$botTask->id} ({$botTask->type}): {$errorMessage}");
            }

            if (DailyPipelineService::isFatalCaptchaError($errorMessage)) {
                app(DailyPipelineService::class)->notifyCaptchaFailure($errorMessage);
            }
        }

        if ($botTask->campaign_site_run_id && $botTask->type !== 'submit_lead') {
            $botTask->campaignSiteRun?->update([
                'status' => 'failed',
                'error_message' => $data['error_message'] ?? null,
                'finished_at' => $data['finished_at'] ?? now(),
                'duration_ms' => $data['duration_ms'] ?? null,
            ]);
        }

        if ($botTask->type === 'discover_yandex_ads') {
            $runId = (int) ($botTask->payload['discoveryRunId'] ?? 0);
            $run = $runId > 0 ? DiscoveryRun::query()->find($runId) : null;
            $run ??= DiscoveryRun::query()->where('bot_task_id', $botTask->id)->first();

            if ($run && ! in_array($run->status, ['completed', 'failed'], true)) {
                app(YandexAdsDiscoveryService::class)->markFailed(
                    $run,
                    $errorMessage !== '' ? $errorMessage : 'Ошибка задачи discovery',
                );
            }
        }

        if (in_array($botTask->type, ['scan_form', 'discover_yandex_ads'], true)) {
            $this->kickPipelineTick();
        }

        return response()->json(['ok' => true]);
    }

    public function siteMapping(Request $request, Site $site): JsonResponse
    {
        $data = $request->validate($this->mappingValidationRules());

        $mapping = FormMapping::query()->updateOrCreate(
            [
                'site_id' => $site->id,
                'mapping_type' => $data['mapping_type'] ?? 'auto',
            ],
            $this->normalizeMappingAttributes($data, $site->id),
        );

        $this->syncSiteStatusAfterScan($site, collect([$mapping]));

        return response()->json([
            'ok' => true,
            'mapping_id' => $mapping->id,
        ]);
    }

    public function siteMappingsBulk(Request $request, Site $site): JsonResponse
    {
        $data = $request->validate([
            'replace_auto' => ['nullable', 'boolean'],
            'mappings' => ['present', 'array'],
            'mappings.*' => ['array'],
            ...collect($this->mappingValidationRules())
                ->mapWithKeys(fn (array $rules, string $key): array => ["mappings.*.{$key}" => $rules])
                ->all(),
        ]);

        $replaceAuto = $data['replace_auto'] ?? true;
        $mappingsData = $data['mappings'];

        $createdMappings = DB::transaction(function () use ($site, $replaceAuto, $mappingsData) {
            if ($replaceAuto) {
                FormMapping::query()
                    ->where('site_id', $site->id)
                    ->where('mapping_type', 'auto')
                    ->delete();
            }

            return collect($mappingsData)
                ->map(fn (array $mappingData): FormMapping => FormMapping::query()->create(
                    $this->normalizeMappingAttributes($mappingData, $site->id),
                ))
                ->values();
        });

        $this->syncSiteStatusAfterScan($site, $createdMappings);
        $this->kickPipelineTick();

        return response()->json([
            'ok' => true,
            'created_count' => $createdMappings->count(),
            'mapping_ids' => $createdMappings->pluck('id')->all(),
        ]);
    }

    public function campaignRunResult(Request $request, CampaignSiteRun $run): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', 'in:success,failed,unknown,skipped'],
            'detected_success_reason' => ['nullable', 'string'],
            'detected_error_reason' => ['nullable', 'string'],
            'response_text' => ['nullable', 'string'],
            'response_url' => ['nullable', 'string'],
            'http_status' => ['nullable', 'integer'],
            'error_message' => ['nullable', 'string'],
            'skip_reason' => ['nullable', 'string'],
            'screenshot_before' => ['nullable', 'string'],
            'screenshot_after' => ['nullable', 'string'],
            'started_at' => ['nullable', 'date'],
            'finished_at' => ['nullable', 'date'],
            'duration_ms' => ['nullable', 'integer', 'min:0'],
        ]);

        // Metrika/beacon URLs and binary beacons blow VARCHAR/TEXT columns.
        if (isset($data['response_url']) && is_string($data['response_url'])) {
            $data['response_url'] = mb_substr($data['response_url'], 0, 191);
        }
        if (isset($data['response_text']) && is_string($data['response_text'])) {
            $data['response_text'] = mb_substr($data['response_text'], 0, 5000);
        }

        $run->update([
            ...$data,
            'finished_at' => $data['finished_at'] ?? now(),
        ]);

        BotTask::query()
            ->where('campaign_site_run_id', $run->id)
            ->where('type', 'submit_lead')
            ->whereIn('status', ['queued', 'processing'])
            ->latest('id')
            ->first()
            ?->update([
                'status' => 'completed',
                'error_message' => in_array($run->status, ['failed', 'unknown'], true) ? ($run->error_message ?? $run->detected_error_reason) : null,
                'finished_at' => $data['finished_at'] ?? now(),
                'duration_ms' => $data['duration_ms'] ?? null,
            ]);

        $campaign = $run->campaign;

        if ($campaign) {
            $campaign->update([
                'success_count' => $campaign->runs()->where('status', 'success')->count(),
                'failed_count' => $campaign->runs()->where('status', 'failed')->count(),
                'skipped_count' => $campaign->runs()->where('status', 'skipped')->count(),
                'unknown_count' => $campaign->runs()->where('status', 'unknown')->count(),
            ]);

            $pendingCount = $campaign->runs()->whereIn('status', ['pending', 'processing'])->count();

            if ($pendingCount === 0) {
                $campaign->update([
                    'status' => $campaign->failed_count > 0 ? 'completed_with_errors' : 'completed',
                    'finished_at' => now(),
                ]);

                $this->notifyTelegramIfNeeded($campaign);
                $this->kickPipelineTick();
            } else {
                $campaign->update([
                    'status' => 'processing',
                    'started_at' => $campaign->started_at ?? now(),
                ]);
            }
        }

        $this->syncProxyStateFromRun($run);

        return response()->json(['ok' => true]);
    }

    public function storeScreenshot(Request $request): JsonResponse
    {
        $data = $request->validate([
            'run_id' => ['nullable', 'exists:campaign_site_runs,id'],
            'disk' => ['nullable', 'string'],
            'filename' => ['nullable', 'string'],
            'base64' => ['required', 'string'],
        ]);

        $disk = $data['disk'] ?? 'local';
        $filename = $data['filename'] ?? Str::uuid().'.png';
        $path = 'screenshots/'.ltrim($filename, '/');

        $raw = preg_replace('/^data:image\/\w+;base64,/', '', $data['base64']);
        $binary = base64_decode((string) $raw, true);

        if ($binary === false) {
            return response()->json([
                'message' => 'Invalid base64 payload.',
            ], 422);
        }

        Storage::disk($disk)->put($path, $binary);

        if (! empty($data['run_id'])) {
            $run = CampaignSiteRun::query()->find($data['run_id']);

            if ($run && blank($run->screenshot_before)) {
                $run->update(['screenshot_before' => $path]);
            } elseif ($run) {
                $run->update(['screenshot_after' => $path]);
            }
        }

        return response()->json([
            'ok' => true,
            'path' => $path,
            'disk' => $disk,
        ]);
    }

    public function discoveryRunResult(Request $request, DiscoveryRun $run): JsonResponse
    {
        $data = $request->validate([
            'items' => ['present', 'array'],
            'items.*.url' => ['nullable', 'string'],
            'items.*.destination_url' => ['nullable', 'string'],
            'items.*.title' => ['nullable', 'string'],
            'items.*.snippet' => ['nullable', 'string'],
            'items.*.yandex_url' => ['nullable', 'string'],
            'items.*.is_promo' => ['nullable', 'boolean'],
            'pages_scanned' => ['nullable', 'integer', 'min:0'],
            'blocked' => ['nullable', 'boolean'],
            'error_message' => ['nullable', 'string', 'max:2000'],
        ]);

        $stats = app(YandexAdsDiscoveryService::class)->applyResults(
            $run,
            $data['items'],
            (int) ($data['pages_scanned'] ?? 0),
            (bool) ($data['blocked'] ?? false),
            isset($data['error_message']) && is_string($data['error_message'])
                ? $data['error_message']
                : null,
        );

        $this->kickPipelineTick();

        return response()->json([
            'ok' => true,
            ...$stats,
        ]);
    }

    private function resolveTask(string $task): BotTask
    {
        abort_unless(ctype_digit($task), 404, 'Task not found.');

        return BotTask::query()->findOrFail((int) $task);
    }

    /**
     * Advance autopipeline immediately after bot stage changes (don't wait only for cron).
     */
    private function kickPipelineTick(): void
    {
        try {
            if (! DailyPipelineRun::query()
                ->whereIn('status', ['pending', 'discovering', 'scanning', 'submitting'])
                ->exists()) {
                return;
            }

            app(DailyPipelineService::class)->tick();
        } catch (\Throwable $e) {
            Log::warning('pipeline.kick_failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * @return array<string, list<string>>
     */
    private function mappingValidationRules(): array
    {
        return [
            'source_url' => ['nullable', 'string'],
            'name_selector' => ['nullable', 'string'],
            'phone_selector' => ['required', 'string'],
            'email_selector' => ['nullable', 'string'],
            'message_selector' => ['nullable', 'string'],
            'submit_selector' => ['required', 'string'],
            'open_modal_selector' => ['nullable', 'string'],
            'pre_form_click_selectors' => ['nullable', 'array'],
            'pre_form_click_selectors.*' => ['string'],
            'pre_form_strategy' => ['nullable', 'in:selectors,quiz_auto'],
            'quiz_container_selector' => ['nullable', 'string'],
            'form_scope_selector' => ['nullable', 'string'],
            'consent_checkbox_selector' => ['nullable', 'string'],
            'consent_checkbox_selectors' => ['nullable', 'array'],
            'consent_checkbox_selectors.*' => ['string'],
            'success_selector' => ['nullable', 'string'],
            'error_selector' => ['nullable', 'string'],
            'iframe_selector' => ['nullable', 'string'],
            'captcha_type' => ['nullable', 'in:none,yandex_smartcaptcha,google_recaptcha_v2,hcaptcha'],
            'captcha_yandex_mode' => ['nullable', 'in:checkbox,slider'],
            'captcha_iframe_selector' => ['nullable', 'string'],
            'captcha_checkbox_selector' => ['nullable', 'string'],
            'captcha_token_selector' => ['nullable', 'string'],
            'success_text' => ['nullable', 'string'],
            'error_text' => ['nullable', 'string'],
            'wait_after_submit_ms' => ['nullable', 'integer', 'min:0'],
            'mapping_type' => ['nullable', 'in:auto,manual'],
            'confidence' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'screenshot_enabled' => ['nullable', 'boolean'],
            'screenshot_path' => ['nullable', 'string'],
            'name_coordinates' => ['nullable', 'array'],
            'phone_coordinates' => ['nullable', 'array'],
            'submit_coordinates' => ['nullable', 'array'],
            'status' => ['nullable', 'in:draft,active,failed'],
        ];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function normalizeMappingAttributes(array $data, int $siteId): array
    {
        $checkboxSelectors = $data['consent_checkbox_selectors'] ?? null;

        if (is_array($checkboxSelectors)) {
            $checkboxSelectors = array_values(array_filter(
                $checkboxSelectors,
                fn (mixed $selector): bool => is_string($selector) && trim($selector) !== '',
            ));
        } else {
            $checkboxSelectors = null;
        }

        if (($checkboxSelectors === null || $checkboxSelectors === []) && filled($data['consent_checkbox_selector'] ?? null)) {
            $checkboxSelectors = [(string) $data['consent_checkbox_selector']];
        }

        if (blank($data['consent_checkbox_selector'] ?? null) && is_array($checkboxSelectors) && $checkboxSelectors !== []) {
            $data['consent_checkbox_selector'] = $checkboxSelectors[0];
        }

        $nameSelector = $data['name_selector'] ?? null;
        if (is_string($nameSelector) && trim($nameSelector) === '') {
            $nameSelector = null;
        }

        $sourceUrl = $data['source_url'] ?? null;
        if (is_string($sourceUrl) && $sourceUrl !== '') {
            // Ad landings with long UTM/yclid must not blow varchar(255).
            $sourceUrl = mb_substr($sourceUrl, 0, 2000);
        } else {
            $sourceUrl = null;
        }

        return [
            ...$data,
            'site_id' => $siteId,
            'source_url' => $sourceUrl,
            'name_selector' => $nameSelector,
            'consent_checkbox_selectors' => $checkboxSelectors,
            'wait_after_submit_ms' => $data['wait_after_submit_ms'] ?? 2000,
            'mapping_type' => $data['mapping_type'] ?? 'auto',
            'confidence' => $data['confidence'] ?? 0,
            'screenshot_enabled' => $data['screenshot_enabled'] ?? false,
            'status' => $data['status'] ?? 'active',
        ];
    }

    private function syncSiteStatusAfterScan(Site $site, Collection $mappings): void
    {
        $hasActive = $mappings->contains(
            fn (FormMapping $mapping): bool => $mapping->status === 'active',
        ) || FormMapping::query()
            ->where('site_id', $site->id)
            ->where('status', 'active')
            ->exists();

        $site->update([
            'status' => $hasActive ? 'ready' : 'needs_manual_mapping',
            'last_scan_at' => now(),
        ]);

        if ($hasActive) {
            try {
                app(DailyPipelineService::class)->refreshPipelinesContainingSite((int) $site->id);
            } catch (\Throwable $e) {
                Log::warning('pipeline.refresh_after_mapping_failed', [
                    'site_id' => $site->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    private function syncProxyStateFromRun(CampaignSiteRun $run): void
    {
        if (! $run->proxy_id) {
            return;
        }

        $campaignName = $run->campaign?->name ?? '';

        if (str_starts_with($campaignName, 'Тест отправки:')) {
            return;
        }

        $proxy = Proxy::query()->find($run->proxy_id);

        if (! $proxy) {
            return;
        }

        // Form success/fail ≠ proxy health. Rotate/pick next proxy; do not pause on site errors.
        if ($run->status === 'success') {
            $proxy->update([
                'status' => 'active',
                'last_used_at' => now(),
                'cooldown_until' => null,
            ]);

            return;
        }

        if (! in_array($run->status, ['failed', 'unknown'], true)) {
            return;
        }

        $proxy->update([
            'last_used_at' => now(),
        ]);

        // Disable only when the error clearly means the proxy itself is dead.
        if (! $this->looksLikeProxyFailure($run)) {
            return;
        }

        $health = app(ProxyHealthChecker::class)->check($proxy);
        if ($health['ok']) {
            $proxy->update([
                'status' => 'active',
                'last_ip' => $health['ip'],
                'cooldown_until' => null,
            ]);

            return;
        }

        $proxy->update([
            'status' => 'disabled',
            'cooldown_until' => null,
        ]);

        Log::warning('proxy.disabled_after_dead_check', [
            'proxy_id' => $proxy->id,
            'run_id' => $run->id,
            'error' => $health['error'],
            'run_error' => $run->error_message,
        ]);
    }

    private function looksLikeProxyFailure(CampaignSiteRun $run): bool
    {
        $text = strtolower(trim(implode(' ', array_filter([
            $run->error_message,
            $run->detected_error_reason,
            $run->skip_reason,
        ]))));

        if ($text === '') {
            return false;
        }

        return (bool) preg_match(
            '/err_proxy|proxy_connection|tunnel_connection|proxy authentication|ns_error_proxy|econnrefused.*proxy|proxy.*timed?\s*out|could not connect to proxy|err_socks|socks.*fail/i',
            $text,
        );
    }

    private function notifyTelegramIfNeeded(\App\Models\Campaign $campaign): void
    {
        if (blank($campaign->telegram_chat_id) || $campaign->telegram_status_notified_at !== null || $campaign->status === 'cancelled') {
            return;
        }

        $message = "Процесс #{$campaign->id} завершена.\n"
            ."Всего сайтов: {$campaign->total_sites}\n"
            ."Успешно: {$campaign->success_count}\n"
            ."Ошибки: {$campaign->failed_count}";

        $sent = $this->telegramNotifier->sendMessage((string) $campaign->telegram_chat_id, $message);

        if ($sent) {
            $campaign->update([
                'telegram_status_notified_at' => now(),
            ]);
        }
    }
}
