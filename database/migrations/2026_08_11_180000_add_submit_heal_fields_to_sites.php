<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sites', function (Blueprint $table): void {
            $table->unsignedSmallInteger('submit_fail_streak')->default(0)->after('notes');
            $table->string('submit_heal_status', 32)->nullable()->after('submit_fail_streak');
            $table->json('submit_heal_meta')->nullable()->after('submit_heal_status');
        });
    }

    public function down(): void
    {
        Schema::table('sites', function (Blueprint $table): void {
            $table->dropColumn(['submit_fail_streak', 'submit_heal_status', 'submit_heal_meta']);
        });
    }
};
