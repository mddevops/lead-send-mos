<?php

namespace App\Support;

use App\Models\ProjectSetting;

final class RuntimeSettings
{
    private static ?ProjectSetting $cached = null;

    public static function refresh(): void
    {
        self::$cached = null;
    }

    public static function settings(): ProjectSetting
    {
        return self::$cached ??= ProjectSetting::query()->firstOrCreate([]);
    }

    public static function botConcurrency(): int
    {
        $fromDb = (int) (self::settings()->bot_concurrency ?? 0);
        if ($fromDb >= 1) {
            return max(1, min(8, $fromDb));
        }

        $fromEnv = (int) env('BOT_CONCURRENCY', 1);

        return max(1, min(8, $fromEnv >= 1 ? $fromEnv : 1));
    }

    public static function captchaApiKey(): string
    {
        $fromDb = trim((string) (self::settings()->captcha_solver_api_key ?? ''));
        if ($fromDb !== '') {
            return $fromDb;
        }

        return trim((string) env('CAPTCHA_SOLVER_API_KEY', ''));
    }

    public static function captchaProvider(): string
    {
        $fromDb = trim((string) (self::settings()->captcha_solver_provider ?? ''));
        if (in_array($fromDb, ['rucaptcha', '2captcha'], true)) {
            return $fromDb;
        }

        $fromEnv = trim((string) env('CAPTCHA_SOLVER_PROVIDER', 'rucaptcha'));

        return in_array($fromEnv, ['rucaptcha', '2captcha'], true) ? $fromEnv : 'rucaptcha';
    }

    public static function captchaEnabled(): bool
    {
        if (self::captchaApiKey() === '') {
            return false;
        }

        $envFlag = env('CAPTCHA_SOLVER_ENABLED');
        if ($envFlag === null) {
            return true;
        }

        return filter_var($envFlag, FILTER_VALIDATE_BOOLEAN);
    }

    public static function telegramBotToken(): string
    {
        $fromDb = trim((string) (self::settings()->telegram_bot_token ?? ''));
        if ($fromDb !== '') {
            return $fromDb;
        }

        return trim((string) (config('services.telegram.bot_token') ?? env('TELEGRAM_BOT_TOKEN', '')));
    }

    public static function telegramWebhookSecret(): string
    {
        $fromDb = trim((string) (self::settings()->telegram_webhook_secret ?? ''));
        if ($fromDb !== '') {
            return $fromDb;
        }

        return trim((string) (config('services.telegram.webhook_secret') ?? env('TELEGRAM_WEBHOOK_SECRET', '')));
    }

    /**
     * @return array{
     *   bot_concurrency: int,
     *   captcha_solver_enabled: bool,
     *   captcha_solver_provider: string,
     *   captcha_solver_api_key: string
     * }
     */
    public static function botRuntimePayload(): array
    {
        return [
            'bot_concurrency' => self::botConcurrency(),
            'captcha_solver_enabled' => self::captchaEnabled(),
            'captcha_solver_provider' => self::captchaProvider(),
            'captcha_solver_api_key' => self::captchaApiKey(),
        ];
    }
}
