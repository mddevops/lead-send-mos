<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('form_mappings', function (Blueprint $table): void {
            $table->string('name_selector', 512)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('form_mappings', function (Blueprint $table): void {
            $table->string('name_selector', 512)->nullable(false)->change();
        });
    }
};
