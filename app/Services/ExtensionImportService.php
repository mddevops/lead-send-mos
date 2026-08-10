<?php

namespace App\Services;

use App\Models\FormMapping;
use App\Models\Region;
use App\Models\Site;
use App\Services\YandexMapsSiteImporter;
use Illuminate\Support\Facades\DB;

class ExtensionImportService
{
    /**
     * @param  list<array<string, mixed>>  $sitesPayload
     * @return array{
     *     created_sites: int,
     *     updated_sites: int,
     *     created_mappings: int,
     *     errors: list<array{url?: string, message: string}>
     * }
     */
    public function import(array $sitesPayload, bool $replaceManual = true): array
    {
        // Extension clones one template across many identical pages.
        $maxForms = 50;

        $createdSites = 0;
        $updatedSites = 0;
        $createdMappings = 0;
        $errors = [];

        foreach ($sitesPayload as $index => $siteData) {
            if (! is_array($siteData)) {
                $errors[] = ['message' => "sites[{$index}] must be an object"];
                continue;
            }

            $rawUrl = is_string($siteData['url'] ?? null) ? trim((string) $siteData['url']) : '';
            $normalizedUrl = YandexMapsSiteImporter::normalizeUrl($rawUrl);
            $domain = YandexMapsSiteImporter::normalizeDomain($rawUrl);

            if ($normalizedUrl === null || $domain === null) {
                $errors[] = [
                    'url' => $rawUrl !== '' ? $rawUrl : null,
                    'message' => "sites[{$index}]: invalid url",
                ];
                continue;
            }

            $regionId = isset($siteData['region_id']) ? (int) $siteData['region_id'] : 0;
            if ($regionId <= 0 || ! Region::query()->whereKey($regionId)->exists()) {
                $errors[] = [
                    'url' => $normalizedUrl,
                    'message' => "sites[{$index}]: region_id is required and must exist",
                ];
                continue;
            }

            $forms = $siteData['forms'] ?? [];
            if (! is_array($forms) || $forms === []) {
                $errors[] = [
                    'url' => $normalizedUrl,
                    'message' => "sites[{$index}]: forms must be a non-empty array",
                ];
                continue;
            }

            if (count($forms) > $maxForms) {
                $errors[] = [
                    'url' => $normalizedUrl,
                    'message' => "sites[{$index}]: too many forms (max {$maxForms})",
                ];
                continue;
            }

            $validForms = [];
            foreach ($forms as $formIndex => $form) {
                if (! is_array($form)) {
                    $errors[] = [
                        'url' => $normalizedUrl,
                        'message' => "sites[{$index}].forms[{$formIndex}] must be an object",
                    ];
                    continue 2;
                }

                $phone = trim((string) ($form['phone_selector'] ?? ''));
                $submit = trim((string) ($form['submit_selector'] ?? ''));
                if ($phone === '' || $submit === '') {
                    $errors[] = [
                        'url' => $normalizedUrl,
                        'message' => "sites[{$index}].forms[{$formIndex}]: phone_selector and submit_selector are required",
                    ];
                    continue 2;
                }

                $validForms[] = $form;
            }

            if ($validForms === []) {
                continue;
            }

            try {
                $stats = DB::transaction(function () use (
                    $siteData,
                    $normalizedUrl,
                    $domain,
                    $regionId,
                    $validForms,
                    $replaceManual,
                ): array {
                    $existing = YandexMapsSiteImporter::findByDomain($domain);
                    $createdSite = false;

                    $name = is_string($siteData['name'] ?? null) && trim((string) $siteData['name']) !== ''
                        ? trim((string) $siteData['name'])
                        : $domain;

                    if ($existing === null) {
                        $site = Site::query()->create([
                            'name' => $name,
                            'region_id' => $regionId,
                            'url' => $normalizedUrl,
                            'status' => 'ready',
                            'source' => 'extension',
                            'discovered_at' => now(),
                            'last_scan_at' => now(),
                        ]);
                        $createdSite = true;
                    } else {
                        $site = $existing;
                        $site->update([
                            'name' => $name,
                            'region_id' => $regionId,
                            'status' => 'ready',
                            'last_scan_at' => now(),
                        ]);
                    }

                    if ($replaceManual) {
                        FormMapping::query()
                            ->where('site_id', $site->id)
                            ->where('mapping_type', 'manual')
                            ->delete();
                    }

                    $mappingCount = 0;
                    foreach ($validForms as $form) {
                        FormMapping::query()->create(
                            $this->normalizeMappingAttributes($form, $site->id),
                        );
                        $mappingCount++;
                    }

                    return [
                        'created_site' => $createdSite,
                        'mappings' => $mappingCount,
                    ];
                });

                if ($stats['created_site']) {
                    $createdSites++;
                } else {
                    $updatedSites++;
                }
                $createdMappings += $stats['mappings'];
            } catch (\Throwable $e) {
                $errors[] = [
                    'url' => $normalizedUrl,
                    'message' => $e->getMessage(),
                ];
            }
        }

        return [
            'created_sites' => $createdSites,
            'updated_sites' => $updatedSites,
            'created_mappings' => $createdMappings,
            'errors' => $errors,
        ];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public function normalizeMappingAttributes(array $data, int $siteId): array
    {
        $checkboxSelectors = $data['consent_checkbox_selectors'] ?? null;

        if (is_array($checkboxSelectors)) {
            $checkboxSelectors = array_values(array_filter(
                $checkboxSelectors,
                fn (mixed $selector): bool => is_string($selector) && trim($selector) !== '',
            ));
        } else {
            $checkboxSelectors = null;
        }

        if (($checkboxSelectors === null || $checkboxSelectors === []) && filled($data['consent_checkbox_selector'] ?? null)) {
            $checkboxSelectors = [(string) $data['consent_checkbox_selector']];
        }

        if (blank($data['consent_checkbox_selector'] ?? null) && is_array($checkboxSelectors) && $checkboxSelectors !== []) {
            $data['consent_checkbox_selector'] = $checkboxSelectors[0];
        }

        $nameSelector = $data['name_selector'] ?? null;
        if (is_string($nameSelector) && trim($nameSelector) === '') {
            $nameSelector = null;
        }

        $sourceUrl = $data['source_url'] ?? null;
        if (is_string($sourceUrl) && $sourceUrl !== '') {
            $sourceUrl = mb_substr($sourceUrl, 0, 2000);
        } else {
            $sourceUrl = null;
        }

        return [
            'site_id' => $siteId,
            'source_url' => $sourceUrl,
            'name_selector' => $nameSelector,
            'phone_selector' => (string) $data['phone_selector'],
            'email_selector' => $data['email_selector'] ?? null,
            'message_selector' => $data['message_selector'] ?? null,
            'submit_selector' => (string) $data['submit_selector'],
            'open_modal_selector' => $data['open_modal_selector'] ?? null,
            'pre_form_click_selectors' => self::normalizeStringList($data['pre_form_click_selectors'] ?? null),
            'pre_form_strategy' => self::normalizePreFormStrategy($data),
            'quiz_container_selector' => $data['quiz_container_selector'] ?? null,
            'form_scope_selector' => $data['form_scope_selector'] ?? null,
            'consent_checkbox_selector' => $data['consent_checkbox_selector'] ?? null,
            'consent_checkbox_selectors' => $checkboxSelectors,
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
            'wait_after_submit_ms' => (int) ($data['wait_after_submit_ms'] ?? 2000),
            'mapping_type' => 'manual',
            'confidence' => (float) ($data['confidence'] ?? 100),
            'screenshot_enabled' => (bool) ($data['screenshot_enabled'] ?? false),
            'screenshot_path' => $data['screenshot_path'] ?? null,
            'status' => $data['status'] ?? 'active',
        ];
    }

    /**
     * @return list<string>|null
     */
    private static function normalizeStringList(mixed $value): ?array
    {
        if (is_string($value)) {
            $value = preg_split('/\s*,\s*/', $value) ?: [];
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
}
