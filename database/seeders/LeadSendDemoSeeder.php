<?php

namespace Database\Seeders;

use App\Models\BotTask;
use App\Models\Campaign;
use App\Models\CampaignSiteRun;
use App\Models\FormMapping;
use App\Models\ProjectSetting;
use App\Models\Proxy;
use App\Models\Site;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class LeadSendDemoSeeder extends Seeder
{
    public function run(): void
    {
        $admin = User::query()->updateOrCreate(
            ['email' => 'admin@example.com'],
            [
                'name' => 'Admin',
                'password' => Hash::make('password'),
            ],
        );

        ProjectSetting::query()->updateOrCreate(
            ['id' => 1],
            [
                'enable_screenshots_global' => true,
                'screenshot_on_scan' => true,
                'screenshot_on_submit_success' => true,
                'screenshot_on_submit_failed' => true,
                'screenshot_on_unknown_result' => true,
                'screenshot_storage_disk' => 'local',
                'screenshot_quality' => 80,
                'proxy_enabled' => true,
                'rotate_proxy_before_each_site' => true,
                'check_ip_before_run' => false,
                'proxy_cooldown_seconds' => 60,
            ],
        );

        $readySite = Site::query()->updateOrCreate(
            ['url' => 'https://example.com/lead-form'],
            [
                'name' => 'Example Lead Form',
                'status' => 'ready',
            ],
        );

        $manualSite = Site::query()->updateOrCreate(
            ['url' => 'https://example.org/contact'],
            [
                'name' => 'Example Manual Mapping',
                'status' => 'needs_manual_mapping',
            ],
        );

        Site::query()->updateOrCreate(
            ['url' => 'https://example.net/disabled'],
            [
                'name' => 'Example Disabled Site',
                'status' => 'disabled',
            ],
        );

        FormMapping::query()->updateOrCreate(
            [
                'site_id' => $readySite->id,
                'mapping_type' => 'auto',
            ],
            [
                'name_selector' => 'input[name="name"]',
                'phone_selector' => 'input[name="phone"]',
                'submit_selector' => 'button[type="submit"]',
                'success_selector' => '.success, .thank-you',
                'status' => 'active',
                'confidence' => 95,
                'wait_after_submit_ms' => 2000,
            ],
        );

        FormMapping::query()->updateOrCreate(
            [
                'site_id' => $manualSite->id,
                'mapping_type' => 'manual',
            ],
            [
                'name_selector' => '#name',
                'phone_selector' => '#phone',
                'submit_selector' => 'form button[type="submit"]',
                'status' => 'draft',
                'confidence' => 100,
                'wait_after_submit_ms' => 2000,
            ],
        );

        $proxy = Proxy::query()->updateOrCreate(
            ['host' => '127.0.0.1', 'port' => 8888],
            [
                'name' => 'Local Proxy',
                'provider' => 'local',
                'type' => 'datacenter',
                'username' => null,
                'password' => null,
                'status' => 'active',
            ],
        );

        $campaign = Campaign::query()->updateOrCreate(
            ['name' => 'Demo Campaign'],
            [
                'phone' => '+79990001122',
                'status' => 'processing',
                'total_sites' => 2,
                'created_by' => $admin->id,
                'started_at' => now(),
            ],
        );

        $run = CampaignSiteRun::query()->updateOrCreate(
            [
                'campaign_id' => $campaign->id,
                'site_id' => $readySite->id,
            ],
            [
                'proxy_id' => $proxy->id,
                'status' => 'pending',
            ],
        );

        BotTask::query()->updateOrCreate(
            [
                'type' => 'submit_lead',
                'campaign_site_run_id' => $run->id,
            ],
            [
                'status' => 'queued',
                'site_id' => $readySite->id,
                'payload' => [
                    'taskId' => null,
                    'siteId' => $readySite->id,
                    'runId' => $run->id,
                    'url' => $readySite->url,
                    'lead' => [
                        'name' => 'Тест',
                        'phone' => '+79990001122',
                    ],
                ],
            ],
        );
    }
}
