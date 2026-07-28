<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('form_mappings', function (Blueprint $table): void {
            $table->json('consent_checkbox_selectors')->nullable()->after('consent_checkbox_selector');
        });
    }

    public function down(): void
    {
        Schema::table('form_mappings', function (Blueprint $table): void {
            $table->dropColumn('consent_checkbox_selectors');
        });
    }
};
