<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('project_settings', function (Blueprint $table): void {
            $table->boolean('pipeline_enabled')->default(false)->after('proxy_change_ip_timeout_ms');
            $table->string('pipeline_start_time', 5)->default('09:00')->after('pipeline_enabled');
            $table->string('pipeline_deadline_time', 5)->default('18:00')->after('pipeline_start_time');
            $table->string('pipeline_timezone')->default('Europe/Moscow')->after('pipeline_deadline_time');
            $table->foreignId('pipeline_region_id')->nullable()->after('pipeline_timezone')->constrained('regions')->nullOnDelete();
            $table->string('pipeline_query_template')->default('Купить авто в {регион}')->after('pipeline_region_id');
            $table->unsignedTinyInteger('pipeline_max_pages')->default(3)->after('pipeline_query_template');
            $table->boolean('pipeline_use_proxy')->default(true)->after('pipeline_max_pages');
            $table->boolean('pipeline_scan_forms')->default(true)->after('pipeline_use_proxy');
            $table->boolean('pipeline_submit_forms')->default(true)->after('pipeline_scan_forms');
            $table->string('pipeline_telegram_chat_id')->nullable()->after('pipeline_submit_forms');
        });

        Schema::create('daily_pipeline_runs', function (Blueprint $table): void {
            $table->id();
            $table->date('run_date');
            $table->string('status', 32)->default('pending');
            $table->foreignId('region_id')->constrained()->cascadeOnDelete();
            $table->string('query');
            $table->foreignId('discovery_run_id')->nullable()->constrained('discovery_runs')->nullOnDelete();
            $table->foreignId('campaign_id')->nullable()->constrained('campaigns')->nullOnDelete();
            $table->unsignedInteger('promo_sites_count')->default(0);
            $table->unsignedInteger('new_sites_count')->default(0);
            $table->unsignedInteger('scan_queued_count')->default(0);
            $table->unsignedInteger('forms_found_count')->default(0);
            $table->unsignedInteger('forms_not_found_count')->default(0);
            $table->unsignedInteger('submit_queued_count')->default(0);
            $table->unsignedInteger('submit_success_count')->default(0);
            $table->unsignedInteger('submit_failed_count')->default(0);
            $table->unsignedInteger('submit_unknown_count')->default(0);
            $table->text('error_message')->nullable();
            $table->timestamp('alert_no_proxy_sent_at')->nullable();
            $table->timestamp('alert_zero_balance_sent_at')->nullable();
            $table->timestamp('summary_sent_at')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('deadline_at')->nullable();
            $table->timestamp('discovery_finished_at')->nullable();
            $table->timestamp('scan_finished_at')->nullable();
            $table->timestamp('submit_finished_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            $table->index(['run_date', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('daily_pipeline_runs');

        Schema::table('project_settings', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('pipeline_region_id');
            $table->dropColumn([
                'pipeline_enabled',
                'pipeline_start_time',
                'pipeline_deadline_time',
                'pipeline_timezone',
                'pipeline_query_template',
                'pipeline_max_pages',
                'pipeline_use_proxy',
                'pipeline_scan_forms',
                'pipeline_submit_forms',
                'pipeline_telegram_chat_id',
            ]);
        });
    }
};
