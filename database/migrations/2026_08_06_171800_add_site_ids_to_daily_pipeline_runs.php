<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('daily_pipeline_runs', function (Blueprint $table): void {
            $table->json('site_ids')->nullable()->after('discovery_run_id');
            $table->string('source', 32)->default('discovery')->after('site_ids');
        });
    }

    public function down(): void
    {
        Schema::table('daily_pipeline_runs', function (Blueprint $table): void {
            $table->dropColumn(['site_ids', 'source']);
        });
    }
};
