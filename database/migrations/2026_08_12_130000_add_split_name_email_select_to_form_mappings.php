<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('form_mappings', function (Blueprint $table) {
            $table->string('first_name_selector', 512)->nullable()->after('name_selector');
            $table->string('last_name_selector', 512)->nullable()->after('first_name_selector');
            $table->json('select_selectors')->nullable()->after('email_selector');
        });
    }

    public function down(): void
    {
        Schema::table('form_mappings', function (Blueprint $table) {
            $table->dropColumn(['first_name_selector', 'last_name_selector', 'select_selectors']);
        });
    }
};
