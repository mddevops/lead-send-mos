<?php

namespace App\Services;

use App\Models\Proxy;
use Illuminate\Support\Facades\Http;
use Throwable;

class ProxyHealthChecker
{
    public function __construct(
        private readonly int $timeoutSeconds = 12,
        private readonly string $checkUrl = 'https://api.ipify.org?format=json',
    ) {}

    /**
     * @return array{ok: bool, ip: ?string, error: ?string, latency_ms: int}
     */
    public function check(Proxy $proxy): array
    {
        $startedAt = microtime(true);
        $proxyUrl = $this->buildProxyUrl($proxy);

        try {
            $response = Http::timeout($this->timeoutSeconds)
                ->connectTimeout($this->timeoutSeconds)
                ->withOptions([
                    'proxy' => [
                        'http' => $proxyUrl,
                        'https' => $proxyUrl,
                    ],
                    'curl' => [
                        CURLOPT_PROXY => $proxyUrl,
                        CURLOPT_HTTPPROXYTUNNEL => true,
                    ],
                ])
                ->acceptJson()
                ->get($this->checkUrl);

            $latencyMs = (int) round((microtime(true) - $startedAt) * 1000);

            if (! $response->successful()) {
                return [
                    'ok' => false,
                    'ip' => null,
                    'error' => 'HTTP '.$response->status(),
                    'latency_ms' => $latencyMs,
                ];
            }

            $ip = $response->json('ip') ?? trim($response->body());

            if (! is_string($ip) || $ip === '' || ! filter_var($ip, FILTER_VALIDATE_IP)) {
                return [
                    'ok' => false,
                    'ip' => null,
                    'error' => 'Некорректный ответ IP',
                    'latency_ms' => $latencyMs,
                ];
            }

            return [
                'ok' => true,
                'ip' => $ip,
                'error' => null,
                'latency_ms' => $latencyMs,
            ];
        } catch (Throwable $e) {
            return [
                'ok' => false,
                'ip' => null,
                'error' => $this->shortError($e->getMessage()),
                'latency_ms' => (int) round((microtime(true) - $startedAt) * 1000),
            ];
        }
    }

    /**
     * Проверяет прокси и отключает нерабочие.
     *
     * @param  iterable<Proxy>  $proxies
     * @return array{
     *     checked: int,
     *     working: list<array{id: int, name: string, ip: ?string, latency_ms: int}>,
     *     failed: list<array{id: int, name: string, error: string}>,
     *     disabled: int
     * }
     */
    public function checkAndDisableDead(iterable $proxies): array
    {
        $working = [];
        $failed = [];
        $disabled = 0;

        foreach ($proxies as $proxy) {
            $result = $this->check($proxy);

            if ($result['ok']) {
                $proxy->forceFill([
                    'status' => 'active',
                    'last_ip' => $result['ip'],
                    'cooldown_until' => null,
                    'last_checked_at' => now(),
                    'last_check_error' => null,
                ])->save();

                $working[] = [
                    'id' => $proxy->id,
                    'name' => $proxy->name,
                    'ip' => $result['ip'],
                    'latency_ms' => $result['latency_ms'],
                ];

                continue;
            }

            $proxy->forceFill([
                'status' => 'disabled',
                'cooldown_until' => null,
                'last_checked_at' => now(),
                'last_check_error' => $result['error'] ?? 'нет ответа',
            ])->save();

            $disabled += 1;

            $failed[] = [
                'id' => $proxy->id,
                'name' => $proxy->name,
                'error' => $result['error'] ?? 'нет ответа',
            ];
        }

        return [
            'checked' => count($working) + count($failed),
            'working' => $working,
            'failed' => $failed,
            'disabled' => $disabled,
            'has_active' => $working !== [],
        ];
    }

    /**
     * Proxies to re-check on the 10-minute health cron (and manual full check).
     * Skips cooldown until cooldown_until passes.
     *
     * @return \Illuminate\Database\Eloquent\Collection<int, Proxy>
     */
    public function proxiesForScheduledCheck()
    {
        return Proxy::query()
            ->where(function ($q): void {
                $q->whereIn('status', ['active', 'disabled', 'failed'])
                    ->orWhere(function ($q2): void {
                        $q2->where('status', 'cooldown')
                            ->where(function ($q3): void {
                                $q3->whereNull('cooldown_until')
                                    ->orWhere('cooldown_until', '<=', now());
                            });
                    });
            })
            ->orderBy('id')
            ->get();
    }

    private function buildProxyUrl(Proxy $proxy): string
    {
        $auth = '';

        if (filled($proxy->username)) {
            $auth = rawurlencode((string) $proxy->username);

            if (filled($proxy->password)) {
                $auth .= ':'.rawurlencode((string) $proxy->password);
            }

            $auth .= '@';
        }

        return sprintf('http://%s%s:%d', $auth, $proxy->host, (int) $proxy->port);
    }

    private function shortError(string $message): string
    {
        $message = preg_replace('/\s+/', ' ', trim($message)) ?? $message;

        if (mb_strlen($message) > 160) {
            return mb_substr($message, 0, 157).'...';
        }

        return $message !== '' ? $message : 'нет ответа';
    }
}
