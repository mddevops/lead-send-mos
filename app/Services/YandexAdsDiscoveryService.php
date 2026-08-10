<?php

namespace App\Services;

use App\Models\BotTask;
use App\Models\DiscoveryRun;
use App\Models\Region;
use App\Models\Site;
use App\Models\SiteExclusion;
use App\Support\ProxyPicker;
use RuntimeException;

class YandexAdsDiscoveryService
{
    /**
     * @return list<string>
     */
    public static function defaultExcludedDomains(): array
    {
        return [
            'avito.ru',
            'auto.ru',
            'drom.ru',
            'youla.ru',
            'ozon.ru',
            'wildberries.ru',
            'market.yandex.ru',
            'yandex.ru',
            'ya.ru',
            'google.com',
            'google.ru',
            'youtube.com',
            'vk.com',
            'ok.ru',
            'facebook.com',
            'instagram.com',
            't.me',
            'telegram.org',
            'whatsapp.com',
            'cian.ru',
            'hh.ru',
            '2gis.ru',
            'maps.yandex.ru',
        ];
    }

    public function ensureDefaultExclusions(): void
    {
        foreach (self::defaultExcludedDomains() as $domain) {
            SiteExclusion::query()->firstOrCreate(
                ['domain' => $domain],
                ['note' => 'Системное исключение', 'is_active' => true],
            );
        }
    }

    public function buildQuery(Region $region, ?string $template = null): string
    {
        $template = trim((string) ($template ?? ''));
        if ($template === '') {
            $template = 'Купить авто в {регион}';
        }

        return str_replace(
            ['{регион}', '{region}'],
            [$region->name, $region->name],
            $template,
        );
    }

    /**
     * Always requires a working proxy. Without one, nothing is queued.
     *
     * @return array{run: DiscoveryRun, task: BotTask}
     */
    public function queueRun(
        Region $region,
        int $maxPages = 3,
        bool $useProxy = true,
        ?string $queryTemplate = null,
        bool $onlyPromo = true,
    ): array {
        $this->ensureDefaultExclusions();

        $proxy = ProxyPicker::pick();
        if ($proxy === null) {
            app(DailyPipelineService::class)->notifyNoProxy('Скан Яндекса не запущен.');

            throw new RuntimeException('Нет доступного proxy');
        }

        $query = $this->buildQuery($region, $queryTemplate);

        $run = DiscoveryRun::query()->create([
            'region_id' => $region->id,
            'query' => $query,
            'only_promo' => $onlyPromo,
            'run_date' => now()->toDateString(),
            'status' => 'queued',
        ]);

        $task = BotTask::query()->create([
            'type' => 'discover_yandex_ads',
            'status' => 'queued',
            'site_id' => null,
            'payload' => [
                'taskId' => null,
                'discoveryRunId' => $run->id,
                'regionId' => $region->id,
                'regionName' => $region->name,
                'query' => $query,
                'maxPages' => max(1, min(5, $maxPages)),
                'onlyPromo' => $onlyPromo,
                'proxy' => ProxyPicker::toPayload($proxy),
            ],
        ]);

        $task->update([
            'payload' => [
                ...($task->payload ?? []),
                'taskId' => $task->id,
            ],
        ]);

        $run->update(['bot_task_id' => $task->id]);
        ProxyPicker::markUsed($proxy);

        return ['run' => $run->fresh(), 'task' => $task->fresh()];
    }

    /**
     * @param  list<array{url?: string, destination_url?: string|null, yandex_url?: string|null, title?: string|null, snippet?: string|null, is_promo?: bool}>  $items
     * @return array{found: int, created: int, skipped_existing: int, skipped_excluded: int, created_ids: list<int>}
     */
    public function applyResults(
        DiscoveryRun $run,
        array $items,
        int $pagesScanned = 0,
        bool $blocked = false,
        ?string $errorMessage = null,
    ): array
    {
        $created = 0;
        $skippedExisting = 0;
        $skippedExcluded = 0;
        $createdIds = [];
        $normalizedItems = [];
        $seenDomains = [];

        $exclusions = SiteExclusion::query()
            ->where('is_active', true)
            ->pluck('domain')
            ->map(fn (string $domain): string => SiteExclusion::normalizeDomain($domain))
            ->all();

        $exclusionSet = array_fill_keys($exclusions, true);

        foreach ($items as $item) {
            if (! is_array($item)) {
                continue;
            }

            $destinationUrl = is_string($item['destination_url'] ?? null) ? trim($item['destination_url']) : null;
            if ($destinationUrl === '' || ! preg_match('#^https?://#i', $destinationUrl)) {
                $destinationUrl = null;
            }

            $rawUrl = is_string($item['url'] ?? null) ? trim($item['url']) : null;
            if ($rawUrl === '') {
                $rawUrl = null;
            }

            $yandexUrl = is_string($item['yandex_url'] ?? null) ? trim($item['yandex_url']) : null;
            if ($yandexUrl === '' || ! preg_match('#^https?://#i', $yandexUrl)) {
                $yandexUrl = null;
            }

            $isPromo = array_key_exists('is_promo', $item)
                ? (bool) $item['is_promo']
                : true;

            // Clean origin only: https://example.ru — never Path breadcrumbs.
            $url = YandexMapsSiteImporter::normalizeUrl($rawUrl)
                ?? YandexMapsSiteImporter::normalizeUrl($destinationUrl);

            if ($url === null) {
                continue;
            }

            $domain = YandexMapsSiteImporter::normalizeDomain($url);

            if ($domain === null || isset($seenDomains[$domain])) {
                continue;
            }

            $title = is_string($item['title'] ?? null) ? trim($item['title']) : null;
            $snippet = is_string($item['snippet'] ?? null) ? trim($item['snippet']) : null;

            // ad_url — предпочтительно landing с UTM или yabs; иначе чистый origin (чтобы не терять сайт).
            $adUrl = $destinationUrl ?? $yandexUrl ?? $url;
            if ($adUrl === null) {
                continue;
            }

            $seenDomains[$domain] = true;

            $normalizedItems[] = [
                'url' => $url,
                'ad_url' => $adUrl,
                'destination_url' => $destinationUrl,
                'yandex_url' => $yandexUrl,
                'domain' => $domain,
                'title' => $title,
                'snippet' => $snippet,
                'is_promo' => $isPromo,
            ];

            if ($this->isExcludedDomain($domain, $exclusionSet)) {
                $skippedExcluded++;

                continue;
            }

            $existing = YandexMapsSiteImporter::findByDomain($url);
            if ($existing !== null) {
                // Attach to this discovery run so pipeline + «Сайты» see all hits.
                // Once seen as promo — stay promo.
                $existing->update([
                    'discovery_run_id' => $run->id,
                    'ad_url' => $isPromo ? $adUrl : ($existing->ad_url ?: $adUrl),
                    'discovered_at' => $existing->discovered_at ?? now(),
                    'region_id' => $existing->region_id ?: $run->region_id,
                    'is_promo' => $isPromo || (bool) $existing->is_promo,
                ]);
                $skippedExisting++;

                continue;
            }

            $notes = $isPromo
                ? 'Найден в рекламе Яндекса: '.$run->query
                : 'Найден в органической выдаче Яндекса: '.$run->query;
            if ($title !== null && $title !== '') {
                $notes .= "\nЗаголовок: ".$title;
            }

            $site = Site::query()->create([
                'name' => $url,
                'region_id' => $run->region_id,
                'url' => $url,
                'ad_url' => $adUrl,
                'status' => 'new',
                'source' => $isPromo ? 'yandex_ads' : 'yandex_organic',
                'is_promo' => $isPromo,
                'discovered_at' => now(),
                'discovery_run_id' => $run->id,
                'notes' => $notes,
            ]);

            $createdIds[] = $site->id;
            $created++;
        }

        $run->update([
            'status' => $blocked ? 'failed' : 'completed',
            'pages_scanned' => $pagesScanned,
            'found_count' => count($normalizedItems),
            'new_sites_count' => $created,
            'skipped_existing_count' => $skippedExisting,
            'skipped_excluded_count' => $skippedExcluded,
            'blocked' => $blocked,
            'found_items' => $normalizedItems,
            'error_message' => $blocked
                ? ($errorMessage !== null && trim($errorMessage) !== ''
                    ? trim($errorMessage)
                    : 'Яндекс показал капчу или страницу блокировки')
                : null,
            'finished_at' => now(),
        ]);

        if ($blocked) {
            $msg = (string) ($run->fresh()?->error_message ?? '');
            if (DailyPipelineService::isFatalCaptchaError($msg)) {
                app(DailyPipelineService::class)->notifyCaptchaFailure($msg);
            }
        }

        return [
            'found' => count($normalizedItems),
            'created' => $created,
            'skipped_existing' => $skippedExisting,
            'skipped_excluded' => $skippedExcluded,
            'created_ids' => $createdIds,
        ];
    }

    public function markFailed(DiscoveryRun $run, string $message): void
    {
        $run->update([
            'status' => 'failed',
            'error_message' => $message,
            'finished_at' => now(),
        ]);

        if (DailyPipelineService::isFatalCaptchaError($message)) {
            app(DailyPipelineService::class)->notifyCaptchaFailure($message);
        }
    }

    public function markProcessing(DiscoveryRun $run): void
    {
        $run->update([
            'status' => 'processing',
            'started_at' => $run->started_at ?? now(),
        ]);
    }

    /**
     * @param  array<string, bool>  $exclusionSet
     */
    private function isExcludedDomain(string $domain, array $exclusionSet): bool
    {
        if (isset($exclusionSet[$domain])) {
            return true;
        }

        foreach (array_keys($exclusionSet) as $excluded) {
            if (str_ends_with($domain, '.'.$excluded)) {
                return true;
            }
        }

        return false;
    }

}
