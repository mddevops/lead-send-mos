<?php

namespace App\Support;

use App\Models\FormMapping;
use App\Models\Site;

class SubmitLeadPayloadBuilder
{
    /** Query keys stripped from submit URLs (keep the clean form page). */
    private const TRACKING_QUERY_KEYS = [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'yclid',
        'ysclid',
        'gclid',
        'fbclid',
        '_openstat',
        'rb_clickid',
        'from',
    ];

    public static function pickMapping(Site $site): ?FormMapping
    {
        return $site->formMappings()
            ->where('status', 'active')
            ->inRandomOrder()
            ->first();
    }

    public static function submitUrl(Site $site, FormMapping $mapping): string
    {
        // Prefer the scanned form page (Filament «Страница с формой»), never the UTM ad landing.
        $sourceUrl = is_string($mapping->source_url) ? trim($mapping->source_url) : '';
        if ($sourceUrl !== '' && preg_match('#^https?://#i', $sourceUrl)) {
            return self::stripTrackingParams($sourceUrl);
        }

        $siteUrl = is_string($site->url) ? trim($site->url) : '';
        if ($siteUrl !== '' && preg_match('#^https?://#i', $siteUrl)) {
            return self::stripTrackingParams($siteUrl);
        }

        $adUrl = is_string($site->ad_url) ? trim($site->ad_url) : '';
        if ($adUrl !== '' && preg_match('#^https?://#i', $adUrl)) {
            return self::stripTrackingParams($adUrl);
        }

        return $site->url ?: '';
    }

    public static function stripTrackingParams(string $url): string
    {
        $parts = parse_url($url);
        if ($parts === false || ! isset($parts['scheme'], $parts['host'])) {
            return $url;
        }

        $query = [];
        if (! empty($parts['query'])) {
            parse_str($parts['query'], $query);
            foreach (array_keys($query) as $key) {
                $lower = strtolower((string) $key);
                if (in_array($lower, self::TRACKING_QUERY_KEYS, true) || str_starts_with($lower, 'utm_')) {
                    unset($query[$key]);
                }
            }
        }

        $rebuilt = $parts['scheme'].'://'.$parts['host'];
        if (isset($parts['port'])) {
            $rebuilt .= ':'.$parts['port'];
        }
        $rebuilt .= $parts['path'] ?? '';
        if ($query !== []) {
            $rebuilt .= '?'.http_build_query($query);
        }
        if (! empty($parts['fragment'])) {
            $rebuilt .= '#'.$parts['fragment'];
        }

        return $rebuilt;
    }

    /**
     * @return array{id: int, name: string}|null
     */
    public static function regionArray(Site $site): ?array
    {
        $site->loadMissing('region');

        if (! $site->region) {
            return null;
        }

        return [
            'id' => (int) $site->region->id,
            'name' => (string) $site->region->name,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function mappingArray(FormMapping $mapping): array
    {
        return [
            'name_selector' => $mapping->name_selector,
            'phone_selector' => $mapping->phone_selector,
            'submit_selector' => $mapping->submit_selector,
            'open_modal_selector' => $mapping->open_modal_selector,
            'form_scope_selector' => $mapping->form_scope_selector,
            'consent_checkbox_selector' => $mapping->consent_checkbox_selector,
            'consent_checkbox_selectors' => $mapping->consent_checkbox_selectors,
            'iframe_selector' => $mapping->iframe_selector,
            'captcha_type' => $mapping->captcha_type ?? 'none',
            'captcha_yandex_mode' => $mapping->captcha_yandex_mode,
            'captcha_iframe_selector' => $mapping->captcha_iframe_selector,
            'captcha_checkbox_selector' => $mapping->captcha_checkbox_selector,
            'captcha_token_selector' => $mapping->captcha_token_selector,
            'success_selector' => $mapping->success_selector,
            'error_selector' => $mapping->error_selector,
            'success_text' => $mapping->success_text,
            'error_text' => $mapping->error_text,
            'wait_after_submit_ms' => $mapping->wait_after_submit_ms,
        ];
    }
}
