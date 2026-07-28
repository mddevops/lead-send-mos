<?php

namespace App\Services;

use App\Models\Proxy;
use Illuminate\Support\Facades\Log;
use Throwable;

class ProxyBulkImporter
{
    public function __construct(
        private readonly ProxyHealthChecker $healthChecker,
    ) {}

    /**
     * @return array{
     *   created: int,
     *   updated: int,
     *   active: int,
     *   disabled: int,
     *   skipped: int,
     *   errors: list<string>,
     *   details: list<array{host: string, port: int, status: string, ip: ?string, error: ?string}>
     * }
     */
    public function importFromText(string $raw): array
    {
        $created = 0;
        $updated = 0;
        $active = 0;
        $disabled = 0;
        $skipped = 0;
        $errors = [];
        $details = [];

        $lines = preg_split('/\R/u', $raw) ?: [];

        foreach ($lines as $index => $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }

            $parsed = $this->parseLine($line);
            if ($parsed === null) {
                $skipped++;
                $errors[] = 'Строка '.($index + 1).': неверный формат (ожидается host:port:user:pass)';

                continue;
            }

            try {
                $existing = Proxy::query()
                    ->where('host', $parsed['host'])
                    ->where('port', $parsed['port'])
                    ->first();

                $attrs = [
                    'name' => $existing?->name ?: sprintf('Pool %s:%d', $parsed['host'], $parsed['port']),
                    'type' => 'mobile',
                    'host' => $parsed['host'],
                    'port' => $parsed['port'],
                    'username' => $parsed['username'],
                    'password' => $parsed['password'],
                    'status' => 'disabled',
                    'cooldown_until' => null,
                ];

                if ($existing) {
                    $existing->fill($attrs)->save();
                    $proxy = $existing->fresh();
                    $updated++;
                } else {
                    $proxy = Proxy::query()->create($attrs);
                    $created++;
                }

                $check = $this->healthChecker->check($proxy);

                if ($check['ok']) {
                    $proxy->forceFill([
                        'status' => 'active',
                        'last_ip' => $check['ip'],
                        'cooldown_until' => null,
                    ])->save();
                    $active++;
                    $details[] = [
                        'host' => $parsed['host'],
                        'port' => $parsed['port'],
                        'status' => 'active',
                        'ip' => $check['ip'],
                        'error' => null,
                    ];
                } else {
                    $proxy->forceFill([
                        'status' => 'disabled',
                        'cooldown_until' => null,
                    ])->save();
                    $disabled++;
                    $details[] = [
                        'host' => $parsed['host'],
                        'port' => $parsed['port'],
                        'status' => 'disabled',
                        'ip' => null,
                        'error' => $check['error'],
                    ];
                }
            } catch (Throwable $e) {
                $skipped++;
                $errors[] = 'Строка '.($index + 1).': '.$e->getMessage();
                Log::warning('proxy.bulk_import_line_failed', [
                    'line' => $index + 1,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return [
            'created' => $created,
            'updated' => $updated,
            'active' => $active,
            'disabled' => $disabled,
            'skipped' => $skipped,
            'errors' => $errors,
            'details' => $details,
        ];
    }

    /**
     * @return array{host: string, port: int, username: ?string, password: ?string}|null
     */
    public function parseLine(string $line): ?array
    {
        $parts = explode(':', $line, 4);
        if (count($parts) < 2) {
            return null;
        }

        $host = trim($parts[0]);
        $port = (int) trim($parts[1]);
        $username = isset($parts[2]) ? trim($parts[2]) : null;
        $password = isset($parts[3]) ? trim($parts[3]) : null;

        if ($host === '' || $port < 1 || $port > 65535) {
            return null;
        }

        if (! filter_var($host, FILTER_VALIDATE_IP) && ! preg_match('/^[a-z0-9.-]+$/i', $host)) {
            return null;
        }

        return [
            'host' => $host,
            'port' => $port,
            'username' => $username !== '' ? $username : null,
            'password' => $password !== '' ? $password : null,
        ];
    }
}
