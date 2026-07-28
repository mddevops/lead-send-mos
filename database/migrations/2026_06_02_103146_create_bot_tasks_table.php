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
        Schema::create('bot_tasks', function (Blueprint $table) {
            $table->id();
            $table->enum('type', ['scan_form', 'submit_lead', 'manual_mapping_session']);
            $table->enum('status', ['queued', 'processing', 'completed', 'failed'])->default('queued');
            $table->foreignId('site_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('campaign_site_run_id')->nullable()->constrained()->nullOnDelete();
            $table->json('payload')->nullable();
            $table->text('error_message')->nullable();
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
        Schema::dropIfExists('bot_tasks');
    }
};
