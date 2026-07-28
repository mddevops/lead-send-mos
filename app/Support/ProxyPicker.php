<?php

namespace App\Support;

use App\Models\ProjectSetting;
use App\Models\Proxy;
use RuntimeException;

final class ProxyPicker
{
    public static function pick(): ?Proxy
    {
        return Proxy::query()
            ->where('status', 'active')
            ->where(function ($query): void {
                $query->whereNull('cooldown_until')
                    ->orWhere('cooldown_until', '<=', now());
            })
            ->orderBy('last_used_at')
            ->first();
    }

    public static function require(): Proxy
    {
        $proxy = self::pick();

        if ($proxy === null) {
            throw new RuntimeException('Нет доступного proxy');
        }

        return $proxy;
    }

    /**
     * @return array{id: int, host: string, port: int, username: ?string, password: ?string, changeIpUrl: ?string}
     */
    public static function toPayload(Proxy $proxy): array
    {
        return [
            'id' => $proxy->id,
            'host' => $proxy->host,
            'port' => $proxy->port,
            'username' => $proxy->username,
            'password' => $proxy->password,
            'changeIpUrl' => $proxy->change_ip_url,
        ];
    }

    /**
     * @return array{rotate_before_each_site: bool, check_ip_before_run: bool, proxy_change_ip_timeout_ms: int}
     */
    public static function configFromSettings(?ProjectSetting $settings = null): array
    {
        $settings ??= ProjectSetting::query()->firstOrCreate([]);

        return [
            'rotate_before_each_site' => (bool) ($settings->rotate_proxy_before_each_site ?? true),
            'check_ip_before_run' => (bool) ($settings->check_ip_before_run ?? true),
            'proxy_change_ip_timeout_ms' => (int) ($settings->proxy_change_ip_timeout_ms ?? 10000),
        ];
    }

    public static function markUsed(Proxy $proxy): void
    {
        $proxy->update(['last_used_at' => now()]);
    }
}
