<?php

namespace App\Support;

final class ParentDomain
{
    /** @var list<string> */
    private const MULTI_PART_TLDS = [
        'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
        'com.ru', 'net.ru', 'org.ru', 'pp.ru', 'spb.ru', 'msk.ru',
        'com.ua', 'org.ua', 'net.ua',
        'com.br', 'com.au', 'co.nz', 'co.jp', 'com.tr',
    ];

    public static function fromUrl(?string $url): ?string
    {
        $host = self::hostFromUrl($url);
        if ($host === null) {
            return null;
        }

        return self::registrable($host);
    }

    public static function hostFromUrl(?string $url): ?string
    {
        if ($url === null || trim($url) === '') {
            return null;
        }

        $raw = trim($url);
        if (! preg_match('#^https?://#i', $raw)) {
            $raw = 'https://'.$raw;
        }

        $host = parse_url($raw, PHP_URL_HOST);
        if (! is_string($host) || $host === '') {
            return null;
        }

        $host = strtolower($host);
        if (str_starts_with($host, 'www.')) {
            $host = substr($host, 4);
        }

        return $host !== '' ? $host : null;
    }

    /**
     * eTLD+1 style parent: rostov.lada.ru → lada.ru, www.example.com → example.com.
     */
    public static function registrable(string $host): string
    {
        $host = strtolower(trim($host));
        if (str_starts_with($host, 'www.')) {
            $host = substr($host, 4);
        }

        $parts = array_values(array_filter(explode('.', $host), fn (string $p): bool => $p !== ''));
        if (count($parts) < 2) {
            return $host;
        }

        $lastTwo = $parts[count($parts) - 2].'.'.$parts[count($parts) - 1];
        if (in_array($lastTwo, self::MULTI_PART_TLDS, true)) {
            if (count($parts) < 3) {
                return $host;
            }

            return $parts[count($parts) - 3].'.'.$lastTwo;
        }

        return $lastTwo;
    }

    /**
     * Replace host in URL, keep path/query/fragment. If $url empty — return $fallbackUrl.
     */
    public static function rewriteUrlHost(?string $url, string $newHost, ?string $fallbackUrl = null): ?string
    {
        $newHost = strtolower(trim($newHost));
        if ($newHost === '') {
            return $url ?: $fallbackUrl;
        }

        if ($url === null || trim($url) === '') {
            return $fallbackUrl;
        }

        $raw = trim($url);
        if (! preg_match('#^https?://#i', $raw)) {
            $raw = 'https://'.$raw;
        }

        $parts = parse_url($raw);
        if ($parts === false || ! isset($parts['scheme'])) {
            return $fallbackUrl ?? $url;
        }

        $rebuilt = $parts['scheme'].'://'.$newHost;
        if (isset($parts['port'])) {
            $rebuilt .= ':'.$parts['port'];
        }
        $rebuilt .= $parts['path'] ?? '';
        if (! empty($parts['query'])) {
            $rebuilt .= '?'.$parts['query'];
        }
        if (! empty($parts['fragment'])) {
            $rebuilt .= '#'.$parts['fragment'];
        }

        return $rebuilt;
    }
}
