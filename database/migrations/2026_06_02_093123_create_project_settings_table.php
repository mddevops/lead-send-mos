<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('project_settings', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('default_submit_timeout_ms')->default(15000);
            $table->unsignedInteger('default_page_load_timeout_ms')->default(30000);
            $table->unsignedInteger('wait_after_submit_ms')->default(2000);
            $table->unsignedInteger('delay_between_sites_ms')->default(500);
            $table->unsignedSmallInteger('max_retries_per_site')->default(1);
            $table->boolean('run_sites_sequentially')->default(true);
            $table->unsignedSmallInteger('max_parallel_workers')->default(1);
            $table->boolean('stop_campaign_on_many_failures')->default(false);
            $table->unsignedSmallInteger('max_failures_before_stop')->default(10);

            $table->boolean('enable_screenshots_global')->default(false);
            $table->boolean('screenshot_on_scan')->default(false);
            $table->boolean('screenshot_on_submit_success')->default(true);
            $table->boolean('screenshot_on_submit_failed')->default(true);
            $table->boolean('screenshot_on_unknown_result')->default(true);
            $table->boolean('screenshot_full_page')->default(true);
            $table->string('screenshot_storage_disk')->default('local');

            $table->boolean('browser_headless')->default(true);
            $table->string('browser_locale')->default('en-US');
            $table->string('browser_timezone')->default('UTC');
            $table->string('user_agent')->nullable();
            $table->unsignedSmallInteger('viewport_width')->default(1280);
            $table->unsignedSmallInteger('viewport_height')->default(720);

            $table->boolean('proxy_enabled')->default(false);
            $table->boolean('rotate_proxy_before_each_site')->default(false);
            $table->unsignedInteger('proxy_cooldown_seconds')->default(60);
            $table->boolean('check_ip_before_run')->default(false);
            $table->unsignedInteger('proxy_change_ip_timeout_ms')->default(10000);
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('project_settings');
    }
};
