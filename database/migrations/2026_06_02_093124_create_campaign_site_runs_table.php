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
        Schema::create('campaign_site_runs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->foreignId('site_id')->constrained()->cascadeOnDelete();
            $table->foreignId('proxy_id')->nullable()->constrained()->nullOnDelete();
            $table->enum('status', ['pending', 'processing', 'success', 'failed', 'skipped', 'unknown'])->default('pending');
            $table->string('skip_reason')->nullable();
            $table->text('error_message')->nullable();
            $table->longText('response_text')->nullable();
            $table->string('response_url')->nullable();
            $table->unsignedSmallInteger('http_status')->nullable();
            $table->string('detected_success_reason')->nullable();
            $table->string('detected_error_reason')->nullable();
            $table->string('screenshot_before')->nullable();
            $table->string('screenshot_after')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->unsignedBigInteger('duration_ms')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('campaign_site_runs');
    }
};
