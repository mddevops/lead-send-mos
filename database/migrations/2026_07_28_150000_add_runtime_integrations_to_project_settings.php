<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('project_settings', function (Blueprint $table): void {
            $table->unsignedTinyInteger('bot_concurrency')->default(1)->after('pipeline_telegram_chat_id');
            $table->string('captcha_solver_provider')->default('rucaptcha')->after('bot_concurrency');
            $table->string('captcha_solver_api_key')->nullable()->after('captcha_solver_provider');
            $table->string('telegram_bot_token')->nullable()->after('captcha_solver_api_key');
            $table->string('telegram_webhook_secret')->nullable()->after('telegram_bot_token');
        });
    }

    public function down(): void
    {
        Schema::table('project_settings', function (Blueprint $table): void {
            $table->dropColumn([
                'bot_concurrency',
                'captcha_solver_provider',
                'captcha_solver_api_key',
                'telegram_bot_token',
                'telegram_webhook_secret',
            ]);
        });
    }
};
