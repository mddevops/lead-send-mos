<?php

namespace App\Services;

use App\Models\DailyPipelineRun;
use App\Models\FormMapping;
use App\Models\Proxy;
use App\Models\ProjectSetting;
use App\Models\Region;
use App\Models\Site;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Throwable;

class DataSyncService
{
    public const VERSION = 1;

    public function __construct(
        private readonly ExtensionImportService $extensionImport,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function exportSites(?array $siteIds = null): array
    {
        $query = Site::query()
            ->with(['region:id,name', 'formMappings'])
            ->orderBy('id');

        if ($siteIds !== null) {
            if ($siteIds === []) {
                return [
                    'version' => self::VERSION,
                    'type' => 'sites',
                    'exported_at' => now()->toIso8601String(),
                    'sites' => [],
                ];
            }
            $query->whereIn('id', array_map('intval', $siteIds));
        }

        $sites = $query->get()->map(fn (Site $site): array => $this->serializeSite($site))->values()->all();

        return [
            'version' => self::VERSION,
            'type' => 'sites',
            'exported_at' => now()->toIso8601String(),
            'sites' => $sites,
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{created_sites: int, updated_sites: int, created_mappings: int, errors: list<array{url?: string, message: string}>}
     */
    public function importSites(array $payload, bool $replaceMappings = true): array
    {
        $sites = $payload['sites'] ?? null;
        if (! is_array($sites)) {
            throw new RuntimeException('payload.sites must be an array');
        }

        $createdSites = 0;
        $updatedSites = 0;
        $createdMappings = 0;
        $errors = [];

        foreach ($sites as $index => $siteData) {
            if (! is_array($siteData)) {
                $errors[] = ['message' => "sites[{$index}] must be an object"];

                continue;
            }

            try {
                $result = $this->upsertSiteWithMappings($siteData, $replaceMappings);
                if ($result['created']) {
                    $createdSites++;
                } else {
                    $updatedSites++;
                }
                $createdMappings += $result['mappings'];
            } catch (Throwable $e) {
                $errors[] = [
                    'url' => is_string($siteData['url'] ?? null) ? (string) $siteData['url'] : null,
                    'message' => $e->getMessage(),
                ];
            }
        }

        return [
            'created_sites' => $createdSites,
            'updated_sites' => $updatedSites,
            'created_mappings' => $createdMappings,
            'errors' => $errors,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function exportProxies(): array
    {
        $proxies = Proxy::query()
            ->orderBy('id')
            ->get()
            ->map(function (Proxy $proxy): array {
                return [
                    'name' => $proxy->name,
                    'provider' => $proxy->provider,
                    'type' => $proxy->type,
                    'host' => $proxy->host,
                    'port' => (int) $proxy->port,
                    'username' => $proxy->username,
                    // Explicit makeVisible for sync — password is hidden on model.
                    'password' => $proxy->password,
                    'change_ip_url' => $proxy->change_ip_url,
                    'status' => $proxy->status,
                    'notes' => $proxy->notes,
                    'last_ip' => $proxy->last_ip,
                ];
            })
            ->values()
            ->all();

        return [
            'version' => self::VERSION,
            'type' => 'proxies',
            'exported_at' => now()->toIso8601String(),
            'proxies' => $proxies,
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{created: int, updated: int, errors: list<string>}
     */
    public function importProxies(array $payload): array
    {
        $proxies = $payload['proxies'] ?? null;
        if (! is_array($proxies)) {
            throw new RuntimeException('payload.proxies must be an array');
        }

        $created = 0;
        $updated = 0;
        $errors = [];

        foreach ($proxies as $index => $row) {
            if (! is_array($row)) {
                $errors[] = "proxies[{$index}] must be an object";

                continue;
            }

            $host = trim((string) ($row['host'] ?? ''));
            $port = (int) ($row['port'] ?? 0);
            if ($host === '' || $port <= 0) {
                $errors[] = "proxies[{$index}]: host and port are required";

                continue;
            }

            try {
                $existing = Proxy::query()->where('host', $host)->where('port', $port)->first();
                $attrs = [
                    'name' => filled($row['name'] ?? null)
                        ? (string) $row['name']
                        : sprintf('Pool %s:%d', $host, $port),
                    'provider' => $row['provider'] ?? $existing?->provider,
                    'type' => $row['type'] ?? $existing?->type ?? 'mobile',
                    'host' => $host,
                    'port' => $port,
                    'username' => $row['username'] ?? null,
                    'password' => array_key_exists('password', $row) ? ($row['password'] ?? null) : $existing?->password,
                    'change_ip_url' => $row['change_ip_url'] ?? null,
                    'status' => $row['status'] ?? 'active',
                    'notes' => $row['notes'] ?? null,
                    'last_ip' => $row['last_ip'] ?? null,
                ];

                if ($existing) {
                    $existing->fill($attrs)->save();
                    $updated++;
                } else {
                    Proxy::query()->create($attrs);
                    $created++;
                }
            } catch (Throwable $e) {
                $errors[] = "proxies[{$index}] {$host}:{$port}: ".$e->getMessage();
            }
        }

        return compact('created', 'updated', 'errors');
    }

    /**
     * Full autopipeline dump: run config + nested sites with form mappings.
     *
     * @return array<string, mixed>
     */
    public function exportPipeline(DailyPipelineRun $pipeline): array
    {
        $pipeline->loadMissing('region');
        $siteIds = app(DailyPipelineService::class)->siteIdsFor($pipeline);
        if ($siteIds === [] && $pipeline->discovery_run_id) {
            $siteIds = Site::query()
                ->where('discovery_run_id', $pipeline->discovery_run_id)
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->all();
        }

        $sitesPayload = $this->exportSites($siteIds);

        $siteUrlById = [];
        foreach ($sitesPayload['sites'] as $siteRow) {
            if (isset($siteRow['id'], $siteRow['url'])) {
                $siteUrlById[(int) $siteRow['id']] = (string) $siteRow['url'];
            }
        }

        // Re-fetch without local DB ids in nested sites for portability.
        $portableSites = array_map(static function (array $site): array {
            unset($site['id']);

            return $site;
        }, $sitesPayload['sites']);

        $siteUrls = [];
        foreach ($siteIds as $id) {
            if (isset($siteUrlById[$id])) {
                $siteUrls[] = $siteUrlById[$id];
            }
        }

        return [
            'version' => self::VERSION,
            'type' => 'daily_pipeline_run',
            'exported_at' => now()->toIso8601String(),
            'pipeline' => [
                'run_date' => optional($pipeline->run_date)->toDateString(),
                'status' => $pipeline->status,
                'region_name' => $pipeline->region?->name,
                'query' => $pipeline->query,
                'max_pages' => $pipeline->max_pages,
                'use_proxy' => (bool) $pipeline->use_proxy,
                'scan_forms' => (bool) $pipeline->scan_forms,
                'submit_forms' => (bool) $pipeline->submit_forms,
                'timezone' => $pipeline->timezone,
                'start_time' => $pipeline->start_time,
                'deadline_time' => $pipeline->deadline_time,
                'source' => $pipeline->source ?? 'sites',
                'site_urls' => $siteUrls,
                'new_sites_count' => (int) $pipeline->new_sites_count,
                'promo_sites_count' => (int) $pipeline->promo_sites_count,
                'forms_found_count' => (int) $pipeline->forms_found_count,
                'forms_not_found_count' => (int) $pipeline->forms_not_found_count,
                'submit_queued_count' => (int) $pipeline->submit_queued_count,
                'submit_success_count' => (int) $pipeline->submit_success_count,
                'submit_failed_count' => (int) $pipeline->submit_failed_count,
                'submit_unknown_count' => (int) $pipeline->submit_unknown_count,
                'report' => $pipeline->report,
                'started_at' => optional($pipeline->started_at)?->toIso8601String(),
                'deadline_at' => optional($pipeline->deadline_at)?->toIso8601String(),
                'discovery_finished_at' => optional($pipeline->discovery_finished_at)?->toIso8601String(),
                'scan_finished_at' => optional($pipeline->scan_finished_at)?->toIso8601String(),
                'submit_finished_at' => optional($pipeline->submit_finished_at)?->toIso8601String(),
                'finished_at' => optional($pipeline->finished_at)?->toIso8601String(),
                'error_message' => $pipeline->error_message,
            ],
            'sites' => $portableSites,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function exportPipelines(?array $pipelineIds = null): array
    {
        $query = DailyPipelineRun::query()->with('region')->orderByDesc('id');
        if ($pipelineIds !== null && $pipelineIds !== []) {
            $query->whereIn('id', array_map('intval', $pipelineIds));
        }

        $runs = $query->get();
        $items = [];
        foreach ($runs as $run) {
            $items[] = $this->exportPipeline($run);
        }

        return [
            'version' => self::VERSION,
            'type' => 'daily_pipeline_runs',
            'exported_at' => now()->toIso8601String(),
            'pipelines' => $items,
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{
     *   created_pipelines: int,
     *   created_sites: int,
     *   updated_sites: int,
     *   created_mappings: int,
     *   errors: list<string>
     * }
     */
    public function importPipeline(array $payload, bool $replaceMappings = true): array
    {
        // Accept either a single pipeline dump or {pipelines:[...]}.
        if (($payload['type'] ?? null) === 'daily_pipeline_runs' && is_array($payload['pipelines'] ?? null)) {
            $createdPipelines = 0;
            $createdSites = 0;
            $updatedSites = 0;
            $createdMappings = 0;
            $errors = [];

            foreach ($payload['pipelines'] as $i => $item) {
                if (! is_array($item)) {
                    $errors[] = "pipelines[{$i}] must be an object";

                    continue;
                }
                try {
                    $r = $this->importPipeline($item, $replaceMappings);
                    $createdPipelines += $r['created_pipelines'];
                    $createdSites += $r['created_sites'];
                    $updatedSites += $r['updated_sites'];
                    $createdMappings += $r['created_mappings'];
                    foreach ($r['errors'] as $err) {
                        $errors[] = $err;
                    }
                } catch (Throwable $e) {
                    $errors[] = "pipelines[{$i}]: ".$e->getMessage();
                }
            }

            return compact('createdPipelines', 'createdSites', 'updatedSites', 'createdMappings', 'errors');
        }

        $pipelineData = $payload['pipeline'] ?? null;
        $sites = $payload['sites'] ?? [];
        if (! is_array($pipelineData)) {
            throw new RuntimeException('payload.pipeline is required');
        }
        if (! is_array($sites)) {
            throw new RuntimeException('payload.sites must be an array');
        }

        return DB::transaction(function () use ($pipelineData, $sites, $replaceMappings): array {
            $siteStats = $this->importSites(['sites' => $sites], $replaceMappings);

            $urlToId = [];
            foreach ($sites as $siteRow) {
                if (! is_array($siteRow)) {
                    continue;
                }
                $url = is_string($siteRow['url'] ?? null) ? trim((string) $siteRow['url']) : '';
                $domain = YandexMapsSiteImporter::normalizeDomain($url);
                if ($domain === null) {
                    continue;
                }
                $site = YandexMapsSiteImporter::findByDomain($domain);
                if ($site) {
                    $normalized = YandexMapsSiteImporter::normalizeUrl($url) ?? $site->url;
                    $urlToId[$normalized] = $site->id;
                    $urlToId[$url] = $site->id;
                    $urlToId[$domain] = $site->id;
                }
            }

            $siteIds = [];
            $siteUrls = is_array($pipelineData['site_urls'] ?? null) ? $pipelineData['site_urls'] : [];
            foreach ($siteUrls as $u) {
                $u = trim((string) $u);
                if ($u === '') {
                    continue;
                }
                if (isset($urlToId[$u])) {
                    $siteIds[$urlToId[$u]] = $urlToId[$u];

                    continue;
                }
                $domain = YandexMapsSiteImporter::normalizeDomain($u);
                $normalized = YandexMapsSiteImporter::normalizeUrl($u);
                if ($domain && isset($urlToId[$domain])) {
                    $siteIds[$urlToId[$domain]] = $urlToId[$domain];
                } elseif ($normalized && isset($urlToId[$normalized])) {
                    $siteIds[$urlToId[$normalized]] = $urlToId[$normalized];
                } elseif ($domain) {
                    $found = YandexMapsSiteImporter::findByDomain($domain);
                    if ($found) {
                        $siteIds[$found->id] = $found->id;
                    }
                }
            }

            // Fallback: all imported sites from this payload.
            if ($siteIds === []) {
                foreach ($urlToId as $id) {
                    $siteIds[(int) $id] = (int) $id;
                }
            }

            $region = $this->resolveRegion(
                is_string($pipelineData['region_name'] ?? null) ? (string) $pipelineData['region_name'] : null,
                isset($pipelineData['region_id']) ? (int) $pipelineData['region_id'] : null,
            );

            if ($region === null) {
                throw new RuntimeException('Не удалось определить регион пайплайна (region_name).');
            }

            $status = (string) ($pipelineData['status'] ?? 'completed');
            // Never import as actively running — avoid conflicting with local workers.
            if (in_array($status, ['pending', 'discovering', 'scanning', 'submitting'], true)) {
                $status = 'cancelled';
            }

            DailyPipelineRun::query()->create([
                'run_date' => $this->parseDate($pipelineData['run_date'] ?? null) ?? now()->toDateString(),
                'status' => $status,
                'region_id' => $region->id,
                'query' => (string) ($pipelineData['query'] ?? 'Импорт пайплайна'),
                'max_pages' => (int) ($pipelineData['max_pages'] ?? 1),
                'use_proxy' => (bool) ($pipelineData['use_proxy'] ?? true),
                'scan_forms' => (bool) ($pipelineData['scan_forms'] ?? true),
                'submit_forms' => (bool) ($pipelineData['submit_forms'] ?? true),
                'submit_cycles_min' => 1,
                'submit_cycles_max' => 1,
                'submit_cycles_planned' => 0,
                'submit_cycle_current' => 0,
                'timezone' => (string) ($pipelineData['timezone'] ?? 'Europe/Moscow'),
                'start_time' => $pipelineData['start_time'] ?? null,
                'deadline_time' => $pipelineData['deadline_time'] ?? null,
                'discovery_run_id' => null,
                'site_ids' => array_values($siteIds),
                'source' => (string) ($pipelineData['source'] ?? 'sites'),
                'campaign_id' => null,
                'new_sites_count' => count($siteIds),
                'promo_sites_count' => (int) ($pipelineData['promo_sites_count'] ?? 0),
                'scan_queued_count' => 0,
                'forms_found_count' => (int) ($pipelineData['forms_found_count'] ?? 0),
                'forms_not_found_count' => (int) ($pipelineData['forms_not_found_count'] ?? 0),
                'submit_queued_count' => (int) ($pipelineData['submit_queued_count'] ?? 0),
                'submit_success_count' => (int) ($pipelineData['submit_success_count'] ?? 0),
                'submit_failed_count' => (int) ($pipelineData['submit_failed_count'] ?? 0),
                'submit_unknown_count' => (int) ($pipelineData['submit_unknown_count'] ?? 0),
                'error_message' => $pipelineData['error_message'] ?? 'Импортировано через API sync',
                'report' => is_array($pipelineData['report'] ?? null) ? $pipelineData['report'] : [],
                'started_at' => $this->parseDateTime($pipelineData['started_at'] ?? null),
                'deadline_at' => $this->parseDateTime($pipelineData['deadline_at'] ?? null),
                'discovery_finished_at' => $this->parseDateTime($pipelineData['discovery_finished_at'] ?? null),
                'scan_finished_at' => $this->parseDateTime($pipelineData['scan_finished_at'] ?? null),
                'submit_finished_at' => $this->parseDateTime($pipelineData['submit_finished_at'] ?? null),
                'finished_at' => $this->parseDateTime($pipelineData['finished_at'] ?? null) ?? now(),
            ]);

            return [
                'created_pipelines' => 1,
                'created_sites' => $siteStats['created_sites'],
                'updated_sites' => $siteStats['updated_sites'],
                'created_mappings' => $siteStats['created_mappings'],
                'errors' => array_map(
                    static fn (array $e): string => ($e['url'] ?? '').': '.($e['message'] ?? ''),
                    $siteStats['errors'],
                ),
            ];
        });
    }

    /**
     * Push a JSON payload to the configured remote lead-send instance.
     * Uses ProjectSetting.sync_remote_url and local BOT_API_TOKEN (same key on both sides).
     *
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function pushToConfiguredRemote(string $path, array $payload): array
    {
        $settings = ProjectSetting::query()->first();
        $remote = trim((string) ($settings?->sync_remote_url ?? ''));
        if ($remote === '') {
            throw new RuntimeException(
                'Не задан URL удалённого сервера. Укажите его в Настройках проекта → «URL удалённого сервера (sync)».',
            );
        }

        $token = trim((string) config('services.bot_worker.token', ''));
        if ($token === '') {
            throw new RuntimeException('Локальный BOT_API_TOKEN пуст — им же авторизуемся на удалённом сервере.');
        }

        return $this->pushToRemote($remote, $token, $path, $payload);
    }

    /**
     * Push a JSON payload to a remote lead-send instance.
     *
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function pushToRemote(string $remoteBaseUrl, string $token, string $path, array $payload): array
    {
        $base = rtrim($remoteBaseUrl, '/');
        if (! str_starts_with($base, 'http://') && ! str_starts_with($base, 'https://')) {
            throw new RuntimeException('remote URL must start with http:// or https://');
        }

        $url = $base.'/api/bot/sync/'.ltrim($path, '/');

        $response = Http::withToken($token)
            ->acceptJson()
            ->timeout(120)
            ->post($url, $payload);

        if (! $response->successful()) {
            throw new RuntimeException(
                "Remote {$url} returned HTTP {$response->status()}: ".mb_substr($response->body(), 0, 500),
            );
        }

        $json = $response->json();

        return is_array($json) ? $json : ['ok' => true, 'raw' => $response->body()];
    }

    /**
     * @return array{created: bool, mappings: int, site: Site}
     */
    private function upsertSiteWithMappings(array $siteData, bool $replaceMappings): array
    {
        $rawUrl = is_string($siteData['url'] ?? null) ? trim((string) $siteData['url']) : '';
        $normalizedUrl = YandexMapsSiteImporter::normalizeUrl($rawUrl);
        $domain = YandexMapsSiteImporter::normalizeDomain($rawUrl);

        if ($normalizedUrl === null || $domain === null) {
            throw new RuntimeException('invalid url');
        }

        $region = $this->resolveRegion(
            is_string($siteData['region_name'] ?? null) ? (string) $siteData['region_name'] : null,
            isset($siteData['region_id']) ? (int) $siteData['region_id'] : null,
        );
        if ($region === null) {
            throw new RuntimeException('region_name / region_id required and must exist');
        }

        return DB::transaction(function () use ($siteData, $normalizedUrl, $domain, $region, $replaceMappings): array {
            $existing = YandexMapsSiteImporter::findByDomain($domain);
            $created = false;

            $name = is_string($siteData['name'] ?? null) && trim((string) $siteData['name']) !== ''
                ? trim((string) $siteData['name'])
                : $domain;

            $attrs = [
                'name' => $name,
                'region_id' => $region->id,
                'url' => $normalizedUrl,
                'ad_url' => $siteData['ad_url'] ?? null,
                'address' => $siteData['address'] ?? null,
                'phone' => $siteData['phone'] ?? null,
                'business_status' => $siteData['business_status'] ?? null,
                'rating_count' => $siteData['rating_count'] ?? null,
                'rating_value' => $siteData['rating_value'] ?? null,
                'status' => $siteData['status'] ?? 'ready',
                'source' => $siteData['source'] ?? 'sync',
                'is_promo' => (bool) ($siteData['is_promo'] ?? false),
                'notes' => $siteData['notes'] ?? null,
                'last_scan_at' => $this->parseDateTime($siteData['last_scan_at'] ?? null) ?? now(),
            ];

            if ($existing === null) {
                $attrs['discovered_at'] = $this->parseDateTime($siteData['discovered_at'] ?? null) ?? now();
                $site = Site::query()->create($attrs);
                $created = true;
            } else {
                $existing->fill($attrs)->save();
                $site = $existing->fresh();
            }

            $mappings = is_array($siteData['form_mappings'] ?? null)
                ? $siteData['form_mappings']
                : (is_array($siteData['forms'] ?? null) ? $siteData['forms'] : []);

            $mappingCount = 0;
            if ($mappings !== []) {
                if ($replaceMappings) {
                    FormMapping::query()->where('site_id', $site->id)->delete();
                }

                foreach ($mappings as $form) {
                    if (! is_array($form)) {
                        continue;
                    }
                    $phone = trim((string) ($form['phone_selector'] ?? ''));
                    $submit = trim((string) ($form['submit_selector'] ?? ''));
                    if ($phone === '' || $submit === '') {
                        continue;
                    }

                    $attrsMapping = $this->extensionImport->normalizeMappingAttributes($form, $site->id);
                    if (isset($form['mapping_type']) && is_string($form['mapping_type'])) {
                        $attrsMapping['mapping_type'] = $form['mapping_type'];
                    }
                    foreach (['name_coordinates', 'phone_coordinates', 'submit_coordinates'] as $coordKey) {
                        if (isset($form[$coordKey]) && is_array($form[$coordKey])) {
                            $attrsMapping[$coordKey] = $form[$coordKey];
                        }
                    }

                    FormMapping::query()->create($attrsMapping);
                    $mappingCount++;
                }
            }

            return ['created' => $created, 'mappings' => $mappingCount, 'site' => $site];
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeSite(Site $site): array
    {
        return [
            'id' => $site->id,
            'name' => $site->name,
            'url' => $site->url,
            'ad_url' => $site->ad_url,
            'address' => $site->address,
            'phone' => $site->phone,
            'business_status' => $site->business_status,
            'rating_count' => $site->rating_count,
            'rating_value' => $site->rating_value,
            'status' => $site->status,
            'source' => $site->source,
            'is_promo' => (bool) $site->is_promo,
            'notes' => $site->notes,
            'region_id' => $site->region_id,
            'region_name' => $site->region?->name,
            'last_scan_at' => optional($site->last_scan_at)?->toIso8601String(),
            'discovered_at' => optional($site->discovered_at)?->toIso8601String(),
            'form_mappings' => $site->formMappings
                ->map(fn (FormMapping $m): array => $this->serializeMapping($m))
                ->values()
                ->all(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeMapping(FormMapping $mapping): array
    {
        return [
            'source_url' => $mapping->source_url,
            'name_selector' => $mapping->name_selector,
            'phone_selector' => $mapping->phone_selector,
            'email_selector' => $mapping->email_selector,
            'message_selector' => $mapping->message_selector,
            'submit_selector' => $mapping->submit_selector,
            'open_modal_selector' => $mapping->open_modal_selector,
            'pre_form_click_selectors' => $mapping->pre_form_click_selectors,
            'pre_form_strategy' => $mapping->pre_form_strategy,
            'quiz_container_selector' => $mapping->quiz_container_selector,
            'form_scope_selector' => $mapping->form_scope_selector,
            'consent_checkbox_selector' => $mapping->consent_checkbox_selector,
            'consent_checkbox_selectors' => $mapping->consent_checkbox_selectors,
            'success_selector' => $mapping->success_selector,
            'error_selector' => $mapping->error_selector,
            'iframe_selector' => $mapping->iframe_selector,
            'captcha_type' => $mapping->captcha_type,
            'captcha_yandex_mode' => $mapping->captcha_yandex_mode,
            'captcha_iframe_selector' => $mapping->captcha_iframe_selector,
            'captcha_checkbox_selector' => $mapping->captcha_checkbox_selector,
            'captcha_token_selector' => $mapping->captcha_token_selector,
            'success_text' => $mapping->success_text,
            'error_text' => $mapping->error_text,
            'wait_after_submit_ms' => $mapping->wait_after_submit_ms,
            'mapping_type' => $mapping->mapping_type,
            'confidence' => $mapping->confidence,
            'screenshot_enabled' => (bool) $mapping->screenshot_enabled,
            'name_coordinates' => $mapping->name_coordinates,
            'phone_coordinates' => $mapping->phone_coordinates,
            'submit_coordinates' => $mapping->submit_coordinates,
            'status' => $mapping->status,
        ];
    }

    private function resolveRegion(?string $regionName, ?int $regionId): ?Region
    {
        $regionName = $regionName !== null ? trim($regionName) : '';
        if ($regionName !== '') {
            $byName = Region::query()->where('name', $regionName)->first();
            if ($byName) {
                return $byName;
            }
        }

        if ($regionId && $regionId > 0) {
            return Region::query()->find($regionId);
        }

        return null;
    }

    private function parseDateTime(mixed $value): ?Carbon
    {
        if ($value === null || $value === '') {
            return null;
        }

        try {
            return Carbon::parse((string) $value);
        } catch (Throwable) {
            return null;
        }
    }

    private function parseDate(mixed $value): ?string
    {
        $dt = $this->parseDateTime($value);

        return $dt?->toDateString();
    }
}
