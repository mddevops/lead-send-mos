<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('daily_pipeline_runs', function (Blueprint $table): void {
            $table->unsignedSmallInteger('submit_cycle_current')->default(0)->change();
        });
    }

    public function down(): void
    {
        Schema::table('daily_pipeline_runs', function (Blueprint $table): void {
            $table->unsignedTinyInteger('submit_cycle_current')->default(0)->change();
        });
    }
};
