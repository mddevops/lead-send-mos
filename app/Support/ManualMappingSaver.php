<?php

namespace App\Support;

use App\Models\FormMapping;
use App\Models\ProjectSetting;
use App\Models\Site;

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
                'phone_selector' => $data['phone_selector'],
                'email_selector' => $data['email_selector'] ?? null,
                'message_selector' => $data['message_selector'] ?? null,
                'submit_selector' => $data['submit_selector'],
                'open_modal_selector' => $data['open_modal_selector'] ?? null,
                'form_scope_selector' => $data['form_scope_selector'] ?? null,
                'consent_checkbox_selector' => $data['consent_checkbox_selector'] ?? null,
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

        return $mapping;
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
