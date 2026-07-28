<?php

namespace App\Services;

use App\Models\Site;
use Illuminate\Validation\ValidationException;

class YandexMapsSiteImporter
{
    public function __construct(
        public int $created = 0,
        public int $skipped = 0,
        /** @var list<string> */
        public array $errors = [],
    ) {}

    /**
     * @return list<array<string, mixed>>
     */
    public static function parseItems(string $json): array
    {
        $json = trim($json);

        if ($json === '') {
            throw ValidationException::withMessages([
                'json' => 'Вставьте JSON с данными из Яндекс Карт.',
            ]);
        }

        $decoded = json_decode($json, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            throw ValidationException::withMessages([
                'json' => 'Некорректный JSON: '.json_last_error_msg(),
            ]);
        }

        if (! is_array($decoded)) {
            throw ValidationException::withMessages([
                'json' => 'Ожидается JSON-массив объектов.',
            ]);
        }

        if ($decoded !== [] && array_is_list($decoded)) {
            return $decoded;
        }

        if (isset($decoded['type'], $decoded['title'])) {
            return [$decoded];
        }

        throw ValidationException::withMessages([
            'json' => 'Ожидается массив организаций или один объект организации.',
        ]);
    }

    public static function normalizeUrl(?string $url): ?string
    {
        $host = self::extractHostname($url);

        if ($host === null) {
            return null;
        }

        return 'https://'.$host;
    }

    /**
     * Extract a clean hostname. Strips Yandex Path breadcrumbs like
     * "site.ru›Model-in-stock…" which parse_url wrongly keeps inside host.
     */
    public static function extractHostname(?string $url): ?string
    {
        if ($url === null) {
            return null;
        }

        $url = trim($url);

        if ($url === '') {
            return null;
        }

        // Cut at breadcrumb / display separators before parse_url sees them.
        $url = preg_split('/[›»▸·|]/u', $url, 2)[0] ?? $url;
        $url = trim($url);

        if ($url === '') {
            return null;
        }

        // Prefer a strict hostname match (ASCII labels) — never trust parse_url alone.
        if (! preg_match(
            '#(?:https?://)?(?:www\.)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)#i',
            $url,
            $matches,
        )) {
            return null;
        }

        $host = strtolower($matches[1]);

        if ($host === '' || str_contains($host, 'yandex') || ! preg_match('/^[a-z0-9.-]+$/', $host)) {
            return null;
        }

        return $host;
    }

    public static function normalizeDomain(?string $url): ?string
    {
        return self::extractHostname($url);
    }

    public static function domainExists(string $normalizedUrl): bool
    {
        return self::findByDomain($normalizedUrl) !== null;
    }

    public static function findByDomain(string $normalizedUrl): ?Site
    {
        $domain = self::normalizeDomain($normalizedUrl);

        if ($domain === null) {
            return null;
        }

        return Site::query()
            ->whereNotNull('url')
            ->get()
            ->first(fn (Site $site): bool => self::normalizeDomain($site->url) === $domain);
    }

    /**
     * @param  array<string, mixed>  $item
     * @return array<string, mixed>|null
     */
    public static function mapItem(array $item, int $regionId): ?array
    {
        $urls = $item['urls'] ?? [];

        if (! is_array($urls) || $urls === []) {
            return null;
        }

        $url = self::normalizeUrl(is_string($urls[0] ?? null) ? $urls[0] : null);

        if ($url === null) {
            return null;
        }

        $phones = $item['phones'] ?? [];
        $phone = null;

        if (is_array($phones) && $phones !== []) {
            $firstPhone = $phones[0];

            if (is_array($firstPhone)) {
                $phone = $firstPhone['value'] ?? $firstPhone['number'] ?? null;
            }
        }

        $ratingData = is_array($item['ratingData'] ?? null) ? $item['ratingData'] : [];
        $ratingValue = $ratingData['ratingValue'] ?? null;

        return [
            'name' => self::resolveName($item),
            'region_id' => $regionId,
            'url' => $url,
            'address' => self::resolveAddress($item),
            'phone' => is_string($phone) ? trim($phone) : null,
            'business_status' => is_string($item['status'] ?? null) ? $item['status'] : null,
            'rating_count' => isset($ratingData['ratingCount']) ? (int) $ratingData['ratingCount'] : null,
            'rating_value' => is_numeric($ratingValue) ? round((float) $ratingValue, 1) : null,
        ];
    }

    /**
     * @param  array<string, mixed>  $item
     */
    private static function resolveName(array $item): string
    {
        foreach (['shortTitle', 'title'] as $key) {
            if (is_string($item[$key] ?? null) && trim($item[$key]) !== '') {
                return trim($item[$key]);
            }
        }

        return 'Без названия';
    }

    /**
     * @param  array<string, mixed>  $item
     */
    private static function resolveAddress(array $item): ?string
    {
        foreach (['fullAddress', 'address', 'description'] as $key) {
            if (is_string($item[$key] ?? null) && trim($item[$key]) !== '') {
                return trim($item[$key]);
            }
        }

        return null;
    }

    public function import(string $json, int $regionId): self
    {
        $items = self::parseItems($json);

        foreach ($items as $index => $item) {
            if (! is_array($item)) {
                $this->errors[] = 'Элемент #'.($index + 1).': ожидается объект.';
                $this->skipped++;

                continue;
            }

            $attributes = self::mapItem($item, $regionId);

            if ($attributes === null) {
                $title = self::resolveName($item);
                $this->errors[] = "{$title}: пропущен — нет URL сайта.";
                $this->skipped++;

                continue;
            }

            $existing = self::domainExists($attributes['url']);

            if ($existing) {
                $this->errors[] = "{$attributes['name']}: пропущен — домен уже есть в базе ({$attributes['url']}).";
                $this->skipped++;

                continue;
            }

            Site::query()->create([
                ...$attributes,
                'status' => 'new',
            ]);
            $this->created++;
        }

        return $this;
    }
}
