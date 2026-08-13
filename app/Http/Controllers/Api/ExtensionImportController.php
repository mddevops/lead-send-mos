<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ProjectSetting;
use App\Models\Region;
use App\Services\ExtensionImportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ExtensionImportController extends Controller
{
    public function meta(): JsonResponse
    {
        $settings = ProjectSetting::query()->first();

        return response()->json([
            'ok' => true,
            'regions' => Region::query()
                ->orderBy('name')
                ->get(['id', 'name'])
                ->map(fn (Region $region): array => [
                    'id' => $region->id,
                    'name' => $region->name,
                ])
                ->values()
                ->all(),
            'max_form_mappings_per_site' => max(1, min(10, (int) ($settings?->max_form_mappings_per_site ?? 5))),
        ]);
    }

    public function import(Request $request, ExtensionImportService $importer): JsonResponse
    {
        $data = $request->validate([
            'replace_manual' => ['nullable', 'boolean'],
            'sites' => ['required', 'array', 'min:1'],
            'sites.*.url' => ['required', 'string', 'max:2000'],
            'sites.*.name' => ['nullable', 'string', 'max:255'],
            'sites.*.region_id' => ['required', 'integer', 'exists:regions,id'],
            'sites.*.forms' => ['required', 'array', 'min:1'],
            'sites.*.forms.*.source_url' => ['nullable', 'string', 'max:2000'],
            'sites.*.forms.*.name_selector' => ['nullable', 'string', 'max:2000'],
            'sites.*.forms.*.phone_selector' => ['required', 'string', 'max:2000'],
            'sites.*.forms.*.email_selector' => ['nullable', 'string', 'max:2000'],
            'sites.*.forms.*.first_name_selector' => ['nullable', 'string', 'max:2000'],
            'sites.*.forms.*.last_name_selector' => ['nullable', 'string', 'max:2000'],
            'sites.*.forms.*.select_selectors' => ['nullable', 'array'],
            'sites.*.forms.*.select_selectors.*' => ['string', 'max:2000'],
            'sites.*.forms.*.message_selector' => ['nullable', 'string', 'max:2000'],
            'sites.*.forms.*.submit_selector' => ['required', 'string', 'max:2000'],
            'sites.*.forms.*.open_modal_selector' => ['nullable', 'string', 'max:2000'],
            'sites.*.forms.*.pre_form_click_selectors' => ['nullable', 'array'],
            'sites.*.forms.*.pre_form_click_selectors.*' => ['string', 'max:2000'],
            'sites.*.forms.*.pre_form_strategy' => ['nullable', 'in:selectors,quiz_auto'],
            'sites.*.forms.*.quiz_container_selector' => ['nullable', 'string', 'max:2000'],
            'sites.*.forms.*.form_scope_selector' => ['nullable', 'string', 'max:2000'],
            'sites.*.forms.*.consent_checkbox_selector' => ['nullable', 'string', 'max:2000'],
            'sites.*.forms.*.consent_checkbox_selectors' => ['nullable', 'array'],
            'sites.*.forms.*.consent_checkbox_selectors.*' => ['string', 'max:2000'],
            'sites.*.forms.*.success_selector' => ['nullable', 'string', 'max:2000'],
            'sites.*.forms.*.error_selector' => ['nullable', 'string', 'max:2000'],
            'sites.*.forms.*.iframe_selector' => ['nullable', 'string', 'max:2000'],
            'sites.*.forms.*.captcha_type' => ['nullable', 'in:none,yandex_smartcaptcha,google_recaptcha_v2,hcaptcha'],
            'sites.*.forms.*.captcha_yandex_mode' => ['nullable', 'in:checkbox,slider'],
            'sites.*.forms.*.success_text' => ['nullable', 'string', 'max:2000'],
            'sites.*.forms.*.error_text' => ['nullable', 'string', 'max:2000'],
            'sites.*.forms.*.wait_after_submit_ms' => ['nullable', 'integer', 'min:0', 'max:60000'],
            'sites.*.forms.*.status' => ['nullable', 'in:draft,active,failed'],
        ]);

        $result = $importer->import(
            $data['sites'],
            (bool) ($data['replace_manual'] ?? true),
        );

        $ok = $result['errors'] === []
            || ($result['created_sites'] + $result['updated_sites']) > 0;

        return response()->json([
            'ok' => $ok,
            ...$result,
        ], $ok ? 200 : 422);
    }
}
