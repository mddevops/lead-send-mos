<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ProjectSetting extends Model
{
    use HasFactory;

    protected $fillable = [
        'default_submit_timeout_ms',
        'default_page_load_timeout_ms',
        'wait_after_submit_ms',
        'delay_between_sites_ms',
        'max_retries_per_site',
        'run_sites_sequentially',
        'max_parallel_workers',
        'stop_campaign_on_many_failures',
        'max_failures_before_stop',
        'max_form_mappings_per_site',
        'enable_screenshots_global',
        'screenshot_on_scan',
        'screenshot_on_submit_success',
        'screenshot_on_submit_failed',
        'screenshot_on_unknown_result',
        'screenshot_full_page',
        'screenshot_storage_disk',
        'screenshot_quality',
        'browser_headless',
        'browser_locale',
        'browser_timezone',
        'user_agent',
        'viewport_width',
        'viewport_height',
        'proxy_enabled',
        'rotate_proxy_before_each_site',
        'proxy_cooldown_seconds',
        'check_ip_before_run',
        'proxy_change_ip_timeout_ms',
        'pipeline_enabled',
        'pipeline_start_time',
        'pipeline_deadline_time',
        'pipeline_timezone',
        'pipeline_region_id',
        'pipeline_query_template',
        'pipeline_max_pages',
        'pipeline_use_proxy',
        'pipeline_scan_forms',
        'pipeline_submit_forms',
        'pipeline_telegram_chat_id',
        'bot_concurrency',
        'captcha_solver_provider',
        'captcha_solver_api_key',
        'telegram_bot_token',
        'telegram_webhook_secret',
        'sync_remote_url',
    ];

    protected function casts(): array
    {
        return [
            'run_sites_sequentially' => 'boolean',
            'stop_campaign_on_many_failures' => 'boolean',
            'enable_screenshots_global' => 'boolean',
            'screenshot_on_scan' => 'boolean',
            'screenshot_on_submit_success' => 'boolean',
            'screenshot_on_submit_failed' => 'boolean',
            'screenshot_on_unknown_result' => 'boolean',
            'screenshot_full_page' => 'boolean',
            'browser_headless' => 'boolean',
            'proxy_enabled' => 'boolean',
            'rotate_proxy_before_each_site' => 'boolean',
            'check_ip_before_run' => 'boolean',
            'pipeline_enabled' => 'boolean',
            'pipeline_use_proxy' => 'boolean',
            'pipeline_scan_forms' => 'boolean',
            'pipeline_submit_forms' => 'boolean',
            'bot_concurrency' => 'integer',
        ];
    }
}
