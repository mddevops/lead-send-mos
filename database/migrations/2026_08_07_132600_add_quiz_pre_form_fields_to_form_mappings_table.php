<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('form_mappings', function (Blueprint $table) {
            $table->json('pre_form_click_selectors')->nullable()->after('open_modal_selector');
            $table->string('pre_form_strategy', 32)->nullable()->after('pre_form_click_selectors');
            $table->text('quiz_container_selector')->nullable()->after('pre_form_strategy');
        });
    }

    public function down(): void
    {
        Schema::table('form_mappings', function (Blueprint $table) {
            $table->dropColumn([
                'pre_form_click_selectors',
                'pre_form_strategy',
                'quiz_container_selector',
            ]);
        });
    }
};
