<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('form_mappings', function (Blueprint $table) {
            $table->string('open_modal_selector')->nullable()->after('submit_selector');
            $table->string('consent_checkbox_selector')->nullable()->after('open_modal_selector');
        });
    }

    public function down(): void
    {
        Schema::table('form_mappings', function (Blueprint $table) {
            $table->dropColumn([
                'open_modal_selector',
                'consent_checkbox_selector',
            ]);
        });
    }
};
