<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sites', function (Blueprint $table): void {
            $table->string('source', 32)->nullable()->after('status');
            $table->timestamp('discovered_at')->nullable()->after('last_scan_at');
            $table->foreignId('discovery_run_id')->nullable()->after('discovered_at')->constrained('discovery_runs')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('sites', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('discovery_run_id');
            $table->dropColumn(['source', 'discovered_at']);
        });
    }
};
