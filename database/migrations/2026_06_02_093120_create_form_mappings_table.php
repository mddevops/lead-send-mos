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
        Schema::create('form_mappings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('site_id')->constrained()->cascadeOnDelete();
            $table->string('name_selector');
            $table->string('phone_selector');
            $table->string('email_selector')->nullable();
            $table->string('message_selector')->nullable();
            $table->string('submit_selector');
            $table->string('success_selector')->nullable();
            $table->string('error_selector')->nullable();
            $table->string('iframe_selector')->nullable();
            $table->text('success_text')->nullable();
            $table->text('error_text')->nullable();
            $table->integer('wait_after_submit_ms')->default(2000);
            $table->enum('mapping_type', ['auto', 'manual'])->default('auto');
            $table->decimal('confidence', 5, 2)->default(0);
            $table->boolean('screenshot_enabled')->default(false);
            $table->string('screenshot_path')->nullable();
            $table->json('name_coordinates')->nullable();
            $table->json('phone_coordinates')->nullable();
            $table->json('submit_coordinates')->nullable();
            $table->enum('status', ['draft', 'active', 'failed'])->default('draft');
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('form_mappings');
    }
};
