<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('daily_pipeline_runs', function (Blueprint $table): void {
            $table->dateTime('scheduled_start_at')->nullable()->after('started_at');
            $table->string('pause_reason')->nullable()->after('error_message');
            $table->boolean('manual_stop')->default(false)->after('pause_reason');
        });

        Schema::table('daily_pipeline_runs', function (Blueprint $table): void {
            $table->dropForeign(['region_id']);
        });

        Schema::table('daily_pipeline_runs', function (Blueprint $table): void {
            $table->foreignId('region_id')->nullable()->change();
            $table->foreign('region_id')->references('id')->on('regions')->nullOnDelete();
        });

        Schema::table('proxies', function (Blueprint $table): void {
            $table->timestamp('last_checked_at')->nullable()->after('last_ip');
            $table->string('last_check_error', 255)->nullable()->after('last_checked_at');
        });
    }

    public function down(): void
    {
        Schema::table('proxies', function (Blueprint $table): void {
            $table->dropColumn(['last_checked_at', 'last_check_error']);
        });

        Schema::table('daily_pipeline_runs', function (Blueprint $table): void {
            $table->dropForeign(['region_id']);
        });

        Schema::table('daily_pipeline_runs', function (Blueprint $table): void {
            $table->foreignId('region_id')->nullable(false)->change();
            $table->foreign('region_id')->references('id')->on('regions')->cascadeOnDelete();
            $table->dropColumn(['scheduled_start_at', 'pause_reason', 'manual_stop']);
        });
    }
};
