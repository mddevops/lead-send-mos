<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('form_mappings', function (Blueprint $table) {
            $table->string('captcha_type', 32)->default('none')->after('iframe_selector');
            $table->string('captcha_iframe_selector', 512)->nullable()->after('captcha_type');
            $table->string('captcha_checkbox_selector', 512)->nullable()->after('captcha_iframe_selector');
            $table->string('captcha_token_selector', 512)->nullable()->after('captcha_checkbox_selector');
        });
    }

    public function down(): void
    {
        Schema::table('form_mappings', function (Blueprint $table) {
            $table->dropColumn([
                'captcha_type',
                'captcha_iframe_selector',
                'captcha_checkbox_selector',
                'captcha_token_selector',
            ]);
        });
    }
};
