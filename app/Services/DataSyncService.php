<?php

namespace App\Services;

use App\Models\DailyPipelineRun;
use App\Models\FormMapping;
use App\Models\Proxy;
use App\Models\ProjectSetting;
use App\Models\Region;
use App\Models\RegionPhonePrefix;
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
     * @param  list<int>|null  $regionIds
     * @return array<string, mixed>
     */
    public function exportRegions(?array $regionIds = null): array
    {
        $query = Region::query()
            ->with(['phonePrefixes' => fn ($q) => $q->orderBy('id')])
            ->orderBy('id');

        if ($regionIds !== null && $regionIds !== []) {
            $query->whereIn('id', array_map('intval', $regionIds));
        }

        $regions = $query->get()->map(fn (Region $region): array => $this->serializeRegion($region))->values()->all();

        return [
            'version' => self::VERSION,
            'type' => 'regions',
            'exported_at' => now()->toIso8601String(),
            'regions' => $regions,
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{created: int, updated: int, synced_prefixes: int, errors: list<array{name?: string, message: string}>}
     */
    public function importRegions(array $payload, bool $replacePrefixes = true): array
    {
        $regions = $payload['regions'] ?? null;
        if (! is_array($regions)) {
            throw new RuntimeException('payload.regions must be an array');
        }

        $created = 0;
        $updated = 0;
        $syncedPrefixes = 0;
        $errors = [];

        foreach ($regions as $index => $row) {
            if (! is_array($row)) {
                $errors[] = ['message' => "regions[{$index}] must be an object"];

                continue;
            }

            $name = trim((string) ($row['name'] ?? ''));
            if ($name === '') {
                $errors[] = ['message' => "regions[{$index}]: name is required"];

                continue;
            }

            try {
                $result = $this->upsertRegionWithPrefixes($row, $replacePrefixes);
                if ($result['created']) {
                    $created++;
                } else {
                    $updated++;
                }
                $syncedPrefixes += $result['prefixes'];
            } catch (Throwable $e) {
                $errors[] = [
                    'name' => $name,
                    'message' => $e->getMessage(),
                ];
            }
        }

        return [
            'created' => $created,
            'updated' => $updated,
            'synced_prefixes' => $syncedPrefixes,
            'errors' => $errors,
        ];
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

        $pipelineService = app(DailyPipelineService::class);
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

        // Per-site «Отправлено / Ошибки» — иначе на удалённом сервере таблица и Excel пустые
        // (там нет локальных CampaignSiteRun исходного прогона).
        $siteSubmitStats = [];
        foreach ($pipelineService->submitStatsBySite($pipeline) as $siteId => $stats) {
            if (! isset($siteUrlById[$siteId])) {
                continue;
            }
            $siteSubmitStats[] = [
                'url' => $siteUrlById[$siteId],
                'total' => (int) ($stats['total'] ?? 0),
                'success' => (int) ($stats['success'] ?? 0),
                'failed' => (int) ($stats['failed'] ?? 0),
                'unknown' => (int) ($stats['unknown'] ?? 0),
                'pending' => (int) ($stats['pending'] ?? 0),
            ];
        }

        $submitRange = $pipelineService->submitTimeRange($pipeline);
        $report = is_array($pipeline->report) ? $pipeline->report : [];
        // Local campaign IDs are meaningless on the remote instance.
        unset($report['counted_campaign_ids']);

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
                'site_submit_stats' => $siteSubmitStats,
                'submit_started_at' => optional($submitRange['start'])?->toIso8601String(),
                'submit_ended_at' => optional($submitRange['end'])?->toIso8601String(),
                'report' => $report,
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
            );

            if ($region === null) {
                throw new RuntimeException('Не удалось определить регион пайплайна (region_name).');
            }

            $status = (string) ($pipelineData['status'] ?? 'completed');
            // Never import as actively running — avoid conflicting with local workers.
            if (in_array($status, ['pending', 'discovering', 'scanning', 'submitting'], true)) {
                $status = 'cancelled';
            }

            $report = is_array($pipelineData['report'] ?? null) ? $pipelineData['report'] : [];
            unset($report['counted_campaign_ids']);

            $importedSiteStats = [];
            $rawSiteStats = is_array($pipelineData['site_submit_stats'] ?? null)
                ? $pipelineData['site_submit_stats']
                : [];
            foreach ($rawSiteStats as $row) {
                if (! is_array($row)) {
                    continue;
                }
                $u = trim((string) ($row['url'] ?? ''));
                if ($u === '') {
                    continue;
                }
                $resolvedId = $urlToId[$u]
                    ?? $urlToId[YandexMapsSiteImporter::normalizeUrl($u) ?? '']
                    ?? $urlToId[YandexMapsSiteImporter::normalizeDomain($u) ?? '']
                    ?? null;
                if (! $resolvedId) {
                    $domain = YandexMapsSiteImporter::normalizeDomain($u);
                    $found = $domain ? YandexMapsSiteImporter::findByDomain($domain) : null;
                    $resolvedId = $found?->id;
                }
                if (! $resolvedId) {
                    continue;
                }
                $importedSiteStats[(int) $resolvedId] = [
                    'total' => (int) ($row['total'] ?? 0),
                    'success' => (int) ($row['success'] ?? 0),
                    'failed' => (int) ($row['failed'] ?? 0),
                    'unknown' => (int) ($row['unknown'] ?? 0),
                    'pending' => (int) ($row['pending'] ?? 0),
                ];
            }
            $report['imported_site_submit_stats'] = $importedSiteStats;
            $report['imported_submit_started_at'] = $pipelineData['submit_started_at'] ?? null;
            $report['imported_submit_ended_at'] = $pipelineData['submit_ended_at'] ?? null;
            $report['sites_count'] = count($siteIds);

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
                'report' => $report,
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
                'Не задан URL удалённого сервера. Укажите его в модалке отправки или в Настройках проекта.',
            );
        }

        return $this->pushToRemoteUrl($remote, $path, $payload);
    }

    /**
     * Push using an explicit remote base URL and local BOT_API_TOKEN.
     *
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function pushToRemoteUrl(string $remoteBaseUrl, string $path, array $payload): array
    {
        $remote = trim($remoteBaseUrl);
        if ($remote === '') {
            throw new RuntimeException('Укажите URL удалённого сервера.');
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

        $existing = YandexMapsSiteImporter::findByDomain($domain);

        // Local and remote region IDs differ. Never trust payload region_id.
        // Existing site: keep its region (e.g. Ростов on server, Волгоград locally).
        // New site: match by name (ё/е, spaces) or create the region.
        $region = null;
        if ($existing === null) {
            $region = $this->resolveRegion(
                is_string($siteData['region_name'] ?? null) ? (string) $siteData['region_name'] : null,
            );
            if ($region === null) {
                throw new RuntimeException(
                    'region_name required to create a new site (region «'.trim((string) ($siteData['region_name'] ?? '')).'»)',
                );
            }
        }

        return DB::transaction(function () use ($siteData, $normalizedUrl, $domain, $region, $replaceMappings, $existing): array {

            $name = is_string($siteData['name'] ?? null) && trim((string) $siteData['name']) !== ''
                ? trim((string) $siteData['name'])
                : $domain;

            $attrs = [
                'name' => $name,
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

            $created = false;

            if ($existing === null) {
                if ($region === null) {
                    throw new RuntimeException('region_name required to create a new site');
                }
                $attrs['region_id'] = $region->id;
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
            'first_name_selector' => $mapping->first_name_selector,
            'last_name_selector' => $mapping->last_name_selector,
            'phone_selector' => $mapping->phone_selector,
            'email_selector' => $mapping->email_selector,
            'select_selectors' => $mapping->select_selectors,
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

    /**
     * @return array<string, mixed>
     */
    private function serializeRegion(Region $region): array
    {
        return [
            'name' => $region->name,
            'operator' => $region->operator,
            'notes' => $region->notes,
            'phone_prefixes' => $region->phonePrefixes
                ->map(static fn (RegionPhonePrefix $prefix): array => [
                    'from' => $prefix->from,
                    'to' => $prefix->to,
                    'operator' => $prefix->operator,
                ])
                ->values()
                ->all(),
        ];
    }

    /**
     * @param  array<string, mixed>  $regionData
     * @return array{created: bool, prefixes: int, region: Region}
     */
    private function upsertRegionWithPrefixes(array $regionData, bool $replacePrefixes): array
    {
        $name = trim((string) ($regionData['name'] ?? ''));
        if ($name === '') {
            throw new RuntimeException('region name is required');
        }

        return DB::transaction(function () use ($regionData, $name, $replacePrefixes): array {
            $existing = $this->findRegionByName($name);
            $created = false;

            $attrs = [
                'name' => $existing?->name ?: $name,
                'operator' => array_key_exists('operator', $regionData)
                    ? ($regionData['operator'] !== null && $regionData['operator'] !== ''
                        ? (string) $regionData['operator']
                        : null)
                    : $existing?->operator,
                'notes' => array_key_exists('notes', $regionData)
                    ? ($regionData['notes'] !== null && $regionData['notes'] !== ''
                        ? (string) $regionData['notes']
                        : null)
                    : $existing?->notes,
            ];

            if ($existing === null) {
                $region = Region::query()->create([
                    ...$attrs,
                    'phone_grid' => null,
                ]);
                $created = true;
            } else {
                $existing->fill($attrs)->save();
                $region = $existing->fresh() ?? $existing;
            }

            $prefixes = is_array($regionData['phone_prefixes'] ?? null)
                ? $regionData['phone_prefixes']
                : [];

            $prefixCount = 0;

            if ($replacePrefixes || $prefixes !== []) {
                if ($replacePrefixes) {
                    $region->phonePrefixes()->delete();
                }

                $now = now();
                $payload = [];
                foreach ($prefixes as $row) {
                    if (! is_array($row)) {
                        continue;
                    }

                    $from = trim((string) ($row['from'] ?? ''));
                    $to = trim((string) ($row['to'] ?? ''));
                    if ($from === '' || $to === '') {
                        continue;
                    }

                    $payload[] = [
                        'region_id' => $region->id,
                        'from' => $from,
                        'to' => $to,
                        'operator' => isset($row['operator']) && is_string($row['operator']) && $row['operator'] !== ''
                            ? $row['operator']
                            : null,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];
                }

                foreach (array_chunk($payload, 500) as $chunk) {
                    RegionPhonePrefix::query()->insert($chunk);
                    $prefixCount += count($chunk);
                }
            }

            return ['created' => $created, 'prefixes' => $prefixCount, 'region' => $region];
        });
    }

    private function findRegionByName(string $regionName): ?Region
    {
        $normalized = $this->normalizeRegionName($regionName);

        return Region::query()->get(['id', 'name', 'operator', 'notes'])->first(
            fn (Region $region): bool => $this->normalizeRegionName($region->name) === $normalized,
        );
    }

    private function resolveRegion(?string $regionName): ?Region
    {
        $regionName = $regionName !== null ? trim($regionName) : '';
        if ($regionName === '') {
            return null;
        }

        $match = $this->findRegionByName($regionName);
        if ($match) {
            return $match;
        }

        return Region::query()->create([
            'name' => $regionName,
            'notes' => 'Создан при синхронизации сайтов',
        ]);
    }

    private function normalizeRegionName(string $name): string
    {
        $name = mb_strtolower(trim($name));
        $name = str_replace(['ё', 'Ё'], 'е', $name);
        $name = preg_replace('/[\s\-]+/u', '', $name) ?? $name;

        return $name;
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
