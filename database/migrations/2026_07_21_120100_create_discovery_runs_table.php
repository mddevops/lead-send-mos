<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('discovery_runs', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('region_id')->constrained()->cascadeOnDelete();
            $table->foreignId('bot_task_id')->nullable()->constrained('bot_tasks')->nullOnDelete();
            $table->string('query');
            $table->date('run_date');
            $table->enum('status', ['queued', 'processing', 'completed', 'failed'])->default('queued');
            $table->unsignedInteger('pages_scanned')->default(0);
            $table->unsignedInteger('found_count')->default(0);
            $table->unsignedInteger('new_sites_count')->default(0);
            $table->unsignedInteger('skipped_existing_count')->default(0);
            $table->unsignedInteger('skipped_excluded_count')->default(0);
            $table->boolean('blocked')->default(false);
            $table->json('found_items')->nullable();
            $table->text('error_message')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            $table->index(['run_date', 'region_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('discovery_runs');
    }
};
