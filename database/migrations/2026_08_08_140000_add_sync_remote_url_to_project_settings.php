<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('project_settings', function (Blueprint $table): void {
            $table->string('sync_remote_url')->nullable()->after('telegram_webhook_secret');
        });
    }

    public function down(): void
    {
        Schema::table('project_settings', function (Blueprint $table): void {
            $table->dropColumn('sync_remote_url');
        });
    }
};
