<?php

namespace App\Services;

use App\Models\FormMapping;
use App\Models\Site;
use App\Support\ParentDomain;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

class SiblingFormMappingReuseService
{
    /**
     * If another subdomain under the same parent domain already has a successful
     * submit + active mappings, clone those mappings onto $site and mark it ready.
     *
     * @return array{reused: true, donor_id: int, donor_name: string, mappings_count: int, parent_domain: string}|null
     */
    public function tryReuseForSite(Site $site): ?array
    {
        if ($site->formMappings()->exists()) {
            return null;
        }

        $this->ensureParentDomain($site);

        $parent = $site->parent_domain;
        if (! is_string($parent) || $parent === '') {
            return null;
        }

        $donor = $this->findBestDonor($site, $parent);
        if ($donor === null) {
            return null;
        }

        $donor->load(['formMappings' => fn ($q) => $q->where('status', 'active')->orderByDesc('id')]);
        if ($donor->formMappings->isEmpty()) {
            return null;
        }

        $targetHost = ParentDomain::hostFromUrl($site->url);
        $donorHost = ParentDomain::hostFromUrl($donor->url);

        try {
            $created = DB::transaction(function () use ($site, $donor, $targetHost, $donorHost) {
                $count = 0;

                foreach ($donor->formMappings as $mapping) {
                    $this->cloneMapping($site, $mapping, $targetHost, $donorHost);
                    $count++;
                }

                $site->update([
                    'status' => 'ready',
                    'last_scan_at' => now(),
                ]);

                return $count;
            });
        } catch (Throwable $e) {
            Log::warning('sibling_mapping.reuse_failed', [
                'site_id' => $site->id,
                'donor_id' => $donor->id,
                'error' => $e->getMessage(),
            ]);

            return null;
        }

        Log::info('sibling_mapping.reused', [
            'site_id' => $site->id,
            'donor_id' => $donor->id,
            'parent_domain' => $parent,
            'mappings_count' => $created,
        ]);

        try {
            app(DailyPipelineService::class)->refreshPipelinesContainingSite((int) $site->id);
        } catch (Throwable $e) {
            Log::warning('sibling_mapping.refresh_pipeline_failed', [
                'site_id' => $site->id,
                'error' => $e->getMessage(),
            ]);
        }

        return [
            'reused' => true,
            'donor_id' => (int) $donor->id,
            'donor_name' => (string) ($donor->name ?: $donor->url),
            'mappings_count' => (int) $created,
            'parent_domain' => $parent,
        ];
    }

    public function ensureParentDomain(Site $site): void
    {
        $computed = ParentDomain::fromUrl($site->url);
        if ($computed === null) {
            return;
        }

        if ($site->parent_domain !== $computed) {
            $site->forceFill(['parent_domain' => $computed])->saveQuietly();
        }
    }

    private function findBestDonor(Site $site, string $parentDomain): ?Site
    {
        return Site::query()
            ->where('parent_domain', $parentDomain)
            ->where('id', '!=', $site->id)
            ->where('status', '!=', 'disabled')
            ->whereHas('formMappings', fn ($q) => $q->where('status', 'active'))
            ->whereHas('campaignSiteRuns', fn ($q) => $q->where('status', 'success'))
            ->withCount([
                'campaignSiteRuns as success_runs_count' => fn ($q) => $q->where('status', 'success'),
            ])
            ->orderByDesc('success_runs_count')
            ->orderByDesc('id')
            ->first();
    }

    private function cloneMapping(
        Site $target,
        FormMapping $source,
        ?string $targetHost,
        ?string $donorHost,
    ): FormMapping {
        $attrs = $source->only([
            'name_selector',
            'first_name_selector',
            'last_name_selector',
            'phone_selector',
            'email_selector',
            'select_selectors',
            'message_selector',
            'submit_selector',
            'open_modal_selector',
            'pre_form_click_selectors',
            'pre_form_strategy',
            'quiz_container_selector',
            'form_scope_selector',
            'consent_checkbox_selector',
            'consent_checkbox_selectors',
            'success_selector',
            'error_selector',
            'iframe_selector',
            'captcha_type',
            'captcha_yandex_mode',
            'captcha_iframe_selector',
            'captcha_checkbox_selector',
            'captcha_token_selector',
            'success_text',
            'error_text',
            'wait_after_submit_ms',
            'confidence',
            'name_coordinates',
            'phone_coordinates',
            'submit_coordinates',
        ]);

        $sourceUrl = $source->source_url;
        if ($targetHost && $donorHost && is_string($sourceUrl) && $sourceUrl !== '') {
            $sourceUrl = ParentDomain::rewriteUrlHost($sourceUrl, $targetHost, $target->url);
            // Also replace leftover donor host in path-less absolute URLs.
            $sourceUrl = str_ireplace($donorHost, $targetHost, (string) $sourceUrl);
        } elseif ($targetHost) {
            $sourceUrl = ParentDomain::rewriteUrlHost($sourceUrl, $targetHost, $target->url);
        } else {
            $sourceUrl = $target->url;
        }

        return FormMapping::query()->create([
            ...$attrs,
            'site_id' => $target->id,
            'source_url' => $sourceUrl,
            'mapping_type' => 'sibling',
            'screenshot_enabled' => false,
            'screenshot_path' => null,
            'status' => 'active',
            'confidence' => $source->confidence ?? 0.9,
        ]);
    }
}
