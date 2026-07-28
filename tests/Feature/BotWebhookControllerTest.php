<?php

namespace Tests\Feature;

use App\Models\BotTask;
use App\Models\Campaign;
use App\Models\CampaignSiteRun;
use App\Models\FormMapping;
use App\Models\ProjectSetting;
use App\Models\Proxy;
use App\Models\Site;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BotWebhookControllerTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('services.bot_worker.token', 'test-bot-token');
    }

    public function test_it_rejects_requests_without_valid_bot_token(): void
    {
        $site = Site::query()->create([
            'name' => 'Unauthorized',
            'url' => 'https://example.com/unauthorized',
            'status' => 'new',
        ]);

        $response = $this->postJson("/api/bot/sites/{$site->id}/mapping", [
            'name_selector' => '#name',
            'phone_selector' => '#phone',
            'submit_selector' => 'button[type="submit"]',
        ]);

        $response->assertUnauthorized();
    }

    public function test_it_creates_or_updates_manual_mapping_and_sets_site_ready(): void
    {
        $site = Site::query()->create([
            'name' => 'Manual Mapping Site',
            'url' => 'https://example.com/manual',
            'status' => 'needs_manual_mapping',
        ]);

        FormMapping::query()->create([
            'site_id' => $site->id,
            'name_selector' => '.old-name',
            'phone_selector' => '.old-phone',
            'submit_selector' => '.old-submit',
            'mapping_type' => 'auto',
            'status' => 'active',
        ]);

        $response = $this
            ->withToken('test-bot-token')
            ->postJson("/api/bot/sites/{$site->id}/mapping", [
                'name_selector' => '#name',
                'phone_selector' => '#phone',
                'submit_selector' => 'button[type="submit"]',
                'mapping_type' => 'manual',
                'status' => 'active',
                'confidence' => 100,
            ]);

        $response->assertOk();

        $this->assertDatabaseHas('form_mappings', [
            'site_id' => $site->id,
            'mapping_type' => 'auto',
            'name_selector' => '.old-name',
        ]);

        $this->assertDatabaseHas('form_mappings', [
            'site_id' => $site->id,
            'mapping_type' => 'manual',
            'name_selector' => '#name',
            'phone_selector' => '#phone',
            'submit_selector' => 'button[type="submit"]',
            'status' => 'active',
        ]);

        $site->refresh();
        $this->assertSame('ready', $site->status);
    }

    public function test_campaign_run_result_recalculates_campaign_and_moves_proxy_to_cooldown(): void
    {
        ProjectSetting::query()->create([
            'proxy_cooldown_seconds' => 120,
        ]);

        $site = Site::query()->create([
            'name' => 'Run Site',
            'url' => 'https://example.com/run',
            'status' => 'ready',
        ]);

        $proxy = Proxy::query()->create([
            'name' => 'Run Proxy',
            'type' => 'datacenter',
            'host' => '127.0.0.1',
            'port' => 8899,
            'status' => 'active',
        ]);

        $campaign = Campaign::query()->create([
            'name' => 'Campaign Under Test',
            'phone' => '+79990000000',
            'status' => 'processing',
            'total_sites' => 1,
        ]);

        $run = CampaignSiteRun::query()->create([
            'campaign_id' => $campaign->id,
            'site_id' => $site->id,
            'proxy_id' => $proxy->id,
            'status' => 'processing',
        ]);

        BotTask::query()->create([
            'type' => 'submit_lead',
            'status' => 'processing',
            'site_id' => $site->id,
            'campaign_site_run_id' => $run->id,
        ]);

        $response = $this
            ->withToken('test-bot-token')
            ->postJson("/api/bot/campaign-runs/{$run->id}/result", [
                'status' => 'failed',
                'error_message' => 'submission failed',
                'detected_error_reason' => 'http_status_500',
                'duration_ms' => 1500,
            ]);

        $response->assertOk();

        $this->assertDatabaseHas('campaign_site_runs', [
            'id' => $run->id,
            'status' => 'failed',
            'error_message' => 'submission failed',
            'detected_error_reason' => 'http_status_500',
            'duration_ms' => 1500,
        ]);

        $this->assertDatabaseHas('bot_tasks', [
            'type' => 'submit_lead',
            'campaign_site_run_id' => $run->id,
            'status' => 'completed',
            'error_message' => 'submission failed',
            'duration_ms' => 1500,
        ]);

        $campaign->refresh();
        $this->assertSame(0, $campaign->success_count);
        $this->assertSame(1, $campaign->failed_count);
        $this->assertSame('completed_with_errors', $campaign->status);
        $this->assertNotNull($campaign->finished_at);

        $proxy->refresh();
        $this->assertSame('cooldown', $proxy->status);
        $this->assertNotNull($proxy->cooldown_until);
    }

    public function test_it_claims_oldest_queued_task_and_marks_it_processing(): void
    {
        $site = Site::query()->create([
            'name' => 'Claim Site',
            'url' => 'https://example.com/claim',
            'status' => 'ready',
        ]);

        $firstTask = BotTask::query()->create([
            'type' => 'scan_form',
            'status' => 'queued',
            'site_id' => $site->id,
            'payload' => ['taskId' => 1, 'siteId' => $site->id, 'url' => $site->url],
        ]);

        $secondTask = BotTask::query()->create([
            'type' => 'submit_lead',
            'status' => 'queued',
            'site_id' => $site->id,
            'payload' => ['taskId' => 2, 'runId' => 1, 'url' => $site->url],
        ]);

        $response = $this
            ->withToken('test-bot-token')
            ->postJson('/api/bot/tasks/claim', ['worker_id' => 'test-worker']);

        $response->assertOk();
        $response->assertJsonPath('task.taskId', $firstTask->id);
        $response->assertJsonPath('task.type', 'scan_form');

        $firstTask->refresh();
        $secondTask->refresh();

        $this->assertSame('processing', $firstTask->status);
        $this->assertNotNull($firstTask->started_at);
        $this->assertSame('queued', $secondTask->status);
    }

    public function test_it_replaces_auto_mappings_in_bulk_and_sets_site_ready(): void
    {
        $site = Site::query()->create([
            'name' => 'Bulk Scan Site',
            'url' => 'https://example.com/bulk',
            'status' => 'scanning',
        ]);

        FormMapping::query()->create([
            'site_id' => $site->id,
            'source_url' => 'https://example.com/bulk',
            'name_selector' => 'input.old-name',
            'phone_selector' => 'input.old-phone',
            'submit_selector' => 'button.old-submit',
            'mapping_type' => 'auto',
            'status' => 'active',
        ]);

        FormMapping::query()->create([
            'site_id' => $site->id,
            'name_selector' => 'input.manual-name',
            'phone_selector' => 'input.manual-phone',
            'submit_selector' => 'button.manual-submit',
            'mapping_type' => 'manual',
            'status' => 'active',
        ]);

        $response = $this
            ->withToken('test-bot-token')
            ->postJson("/api/bot/sites/{$site->id}/mappings/bulk", [
                'replace_auto' => true,
                'mappings' => [
                    [
                        'source_url' => 'https://example.com/bulk',
                        'name_selector' => 'input[name="name"]',
                        'phone_selector' => 'input[name="phone"]',
                        'submit_selector' => 'button[type="submit"]',
                        'mapping_type' => 'auto',
                        'confidence' => 85,
                        'status' => 'active',
                    ],
                    [
                        'source_url' => 'https://example.com/bulk/contacts',
                        'name_selector' => 'input[name="name"]',
                        'phone_selector' => 'input[name="telephone"]',
                        'submit_selector' => 'button[type="submit"]',
                        'consent_checkbox_selector' => 'input[type="checkbox"]',
                        'consent_checkbox_selectors' => [
                            'input[name="agree"]',
                            'input[name="policy"]',
                        ],
                        'mapping_type' => 'auto',
                        'confidence' => 100,
                        'status' => 'active',
                    ],
                ],
            ]);

        $response->assertOk();
        $response->assertJsonPath('created_count', 2);

        $this->assertDatabaseMissing('form_mappings', [
            'site_id' => $site->id,
            'phone_selector' => 'input.old-phone',
        ]);

        $this->assertDatabaseHas('form_mappings', [
            'site_id' => $site->id,
            'mapping_type' => 'manual',
            'phone_selector' => 'input.manual-phone',
        ]);

        $this->assertDatabaseHas('form_mappings', [
            'site_id' => $site->id,
            'source_url' => 'https://example.com/bulk/contacts',
            'phone_selector' => 'input[name="telephone"]',
            'status' => 'active',
        ]);

        $site->refresh();
        $this->assertSame('ready', $site->status);
        $this->assertNotNull($site->last_scan_at);
    }
}
