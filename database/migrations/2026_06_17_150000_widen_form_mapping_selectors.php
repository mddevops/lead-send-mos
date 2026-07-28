<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('form_mappings', function (Blueprint $table) {
            $table->string('name_selector', 512)->change();
            $table->string('phone_selector', 512)->change();
            $table->string('submit_selector', 512)->change();
            $table->string('open_modal_selector', 512)->nullable()->change();
            $table->string('form_scope_selector', 512)->nullable()->change();
            $table->string('consent_checkbox_selector', 512)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('form_mappings', function (Blueprint $table) {
            $table->string('name_selector')->change();
            $table->string('phone_selector')->change();
            $table->string('submit_selector')->change();
            $table->string('open_modal_selector')->nullable()->change();
            $table->string('form_scope_selector')->nullable()->change();
            $table->string('consent_checkbox_selector')->nullable()->change();
        });
    }
};
