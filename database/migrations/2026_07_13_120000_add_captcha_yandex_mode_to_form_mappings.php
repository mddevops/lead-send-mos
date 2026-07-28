<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('form_mappings', function (Blueprint $table) {
            $table->string('captcha_yandex_mode', 16)->nullable()->after('captcha_type');
        });
    }

    public function down(): void
    {
        Schema::table('form_mappings', function (Blueprint $table) {
            $table->dropColumn('captcha_yandex_mode');
        });
    }
};
