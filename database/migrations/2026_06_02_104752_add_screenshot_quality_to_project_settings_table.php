<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('project_settings', function (Blueprint $table) {
            $table->unsignedTinyInteger('screenshot_quality')->default(80)->after('screenshot_storage_disk');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('project_settings', function (Blueprint $table) {
            $table->dropColumn('screenshot_quality');
        });
    }
};
