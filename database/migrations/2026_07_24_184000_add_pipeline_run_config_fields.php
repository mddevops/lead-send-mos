<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('daily_pipeline_runs', function (Blueprint $table): void {
            $table->unsignedTinyInteger('max_pages')->default(3)->after('query');
            $table->boolean('use_proxy')->default(true)->after('max_pages');
            $table->boolean('scan_forms')->default(true)->after('use_proxy');
            $table->boolean('submit_forms')->default(true)->after('scan_forms');
            $table->unsignedTinyInteger('submit_cycles_min')->default(1)->after('submit_forms');
            $table->unsignedTinyInteger('submit_cycles_max')->default(1)->after('submit_cycles_min');
            $table->unsignedTinyInteger('submit_cycles_planned')->default(1)->after('submit_cycles_max');
            $table->unsignedTinyInteger('submit_cycle_current')->default(0)->after('submit_cycles_planned');
            $table->string('timezone')->default('Europe/Moscow')->after('submit_cycle_current');
            $table->string('start_time', 5)->nullable()->after('timezone');
            $table->string('deadline_time', 5)->nullable()->after('start_time');
            $table->json('report')->nullable()->after('error_message');
        });
    }

    public function down(): void
    {
        Schema::table('daily_pipeline_runs', function (Blueprint $table): void {
            $table->dropColumn([
                'max_pages',
                'use_proxy',
                'scan_forms',
                'submit_forms',
                'submit_cycles_min',
                'submit_cycles_max',
                'submit_cycles_planned',
                'submit_cycle_current',
                'timezone',
                'start_time',
                'deadline_time',
                'report',
            ]);
        });
    }
};
