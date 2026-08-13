<?php

namespace App\Support;

use App\Models\FormMapping;
use App\Models\ProjectSetting;
use App\Models\Site;
use App\Services\DailyPipelineService;
use Throwable;

class ManualMappingSaver
{
    /**
     * @param  array<string, mixed>  $data
     */
    public static function save(Site $site, array $data, bool $activate = true): FormMapping
    {
        $settings = ProjectSetting::query()->first();

        $mapping = FormMapping::query()->updateOrCreate(
            [
                'site_id' => $site->id,
                'mapping_type' => 'manual',
            ],
            [
                'name_selector' => $data['name_selector'],
                'first_name_selector' => $data['first_name_selector'] ?? null,
                'last_name_selector' => $data['last_name_selector'] ?? null,
                'phone_selector' => $data['phone_selector'],
                'email_selector' => $data['email_selector'] ?? null,
                'select_selectors' => self::normalizeStringList($data['select_selectors'] ?? null),
                'message_selector' => $data['message_selector'] ?? null,
                'submit_selector' => $data['submit_selector'],
                'open_modal_selector' => $data['open_modal_selector'] ?? null,
                'pre_form_click_selectors' => self::normalizeStringList($data['pre_form_click_selectors'] ?? null),
                'pre_form_strategy' => self::normalizePreFormStrategy($data),
                'quiz_container_selector' => filled($data['quiz_container_selector'] ?? null)
                    ? (string) $data['quiz_container_selector']
                    : null,
                'form_scope_selector' => $data['form_scope_selector'] ?? null,
                'consent_checkbox_selector' => $data['consent_checkbox_selector'] ?? null,
                'consent_checkbox_selectors' => self::normalizeConsentSelectors($data),
                'success_selector' => $data['success_selector'] ?? null,
                'error_selector' => $data['error_selector'] ?? null,
                'iframe_selector' => $data['iframe_selector'] ?? null,
                'captcha_type' => $data['captcha_type'] ?? 'none',
                'captcha_yandex_mode' => ($data['captcha_type'] ?? 'none') === 'yandex_smartcaptcha'
                    ? ($data['captcha_yandex_mode'] ?? 'checkbox')
                    : null,
                'captcha_iframe_selector' => $data['captcha_iframe_selector'] ?? null,
                'captcha_checkbox_selector' => $data['captcha_checkbox_selector'] ?? null,
                'captcha_token_selector' => $data['captcha_token_selector'] ?? null,
                'success_text' => $data['success_text'] ?? null,
                'error_text' => $data['error_text'] ?? null,
                'wait_after_submit_ms' => (int) ($data['wait_after_submit_ms'] ?? $settings?->wait_after_submit_ms ?? 2000),
                'mapping_type' => 'manual',
                'confidence' => 100,
                'screenshot_enabled' => (bool) ($data['screenshot_enabled'] ?? false),
                'name_coordinates' => self::parseCoordinates($data['name_coordinates'] ?? null),
                'phone_coordinates' => self::parseCoordinates($data['phone_coordinates'] ?? null),
                'submit_coordinates' => self::parseCoordinates($data['submit_coordinates'] ?? null),
                'status' => $activate ? 'active' : 'draft',
            ],
        );

        $site->update([
            'status' => $activate ? 'ready' : 'needs_manual_mapping',
            'last_scan_at' => now(),
        ]);

        if ($activate) {
            try {
                app(DailyPipelineService::class)->refreshPipelinesContainingSite((int) $site->id);
            } catch (Throwable) {
                // Stats refresh must not block mapping save.
            }
        }

        return $mapping;
    }

    /**
     * @param  array<string, mixed>  $data
     * @return list<string>|null
     */
    private static function normalizeConsentSelectors(array $data): ?array
    {
        $selectors = $data['consent_checkbox_selectors'] ?? null;

        if (is_string($selectors)) {
            $selectors = preg_split('/\s*,\s*/', $selectors) ?: [];
        }

        if (! is_array($selectors)) {
            $selectors = [];
        }

        $first = $data['consent_checkbox_selector'] ?? null;
        if (filled($first)) {
            array_unshift($selectors, (string) $first);
        }

        $unique = array_values(array_unique(array_filter(
            array_map(static fn ($value): string => trim((string) $value), $selectors),
            static fn (string $value): bool => $value !== '',
        )));

        return $unique === [] ? null : $unique;
    }

    /**
     * @return list<string>|null
     */
    private static function normalizeStringList(mixed $value): ?array
    {
        if (is_string($value)) {
            $value = preg_split('/\r\n|\r|\n|,/', $value) ?: [];
        }

        if (! is_array($value)) {
            return null;
        }

        $list = array_values(array_filter(
            array_map(static fn ($item): string => trim((string) $item), $value),
            static fn (string $item): bool => $item !== '',
        ));

        return $list === [] ? null : $list;
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private static function normalizePreFormStrategy(array $data): ?string
    {
        $strategy = $data['pre_form_strategy'] ?? null;
        if (is_string($strategy) && in_array($strategy, ['selectors', 'quiz_auto'], true)) {
            return $strategy;
        }

        $clicks = self::normalizeStringList($data['pre_form_click_selectors'] ?? null);

        return ($clicks !== null && $clicks !== []) ? 'selectors' : null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function parseCoordinates(mixed $value): ?array
    {
        if (blank($value)) {
            return null;
        }

        if (is_array($value)) {
            return $value;
        }

        $decoded = json_decode((string) $value, true);

        return is_array($decoded) ? $decoded : null;
    }
}
