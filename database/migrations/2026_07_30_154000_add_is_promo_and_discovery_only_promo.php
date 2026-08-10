<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sites', function (Blueprint $table): void {
            $table->boolean('is_promo')->default(true)->after('source');
        });

        Schema::table('discovery_runs', function (Blueprint $table): void {
            $table->boolean('only_promo')->default(true)->after('query');
        });
    }

    public function down(): void
    {
        Schema::table('sites', function (Blueprint $table): void {
            $table->dropColumn('is_promo');
        });

        Schema::table('discovery_runs', function (Blueprint $table): void {
            $table->dropColumn('only_promo');
        });
    }
};
