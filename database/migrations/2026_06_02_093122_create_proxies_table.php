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
        Schema::create('proxies', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('provider')->nullable();
            $table->enum('type', ['mobile', 'residential', 'datacenter']);
            $table->string('host');
            $table->unsignedInteger('port');
            $table->string('username')->nullable();
            $table->text('password')->nullable();
            $table->string('change_ip_url')->nullable();
            $table->enum('status', ['active', 'disabled', 'cooldown', 'failed'])->default('active');
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('cooldown_until')->nullable();
            $table->string('last_ip')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('proxies');
    }
};
