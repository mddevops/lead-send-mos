<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('person_names', function (Blueprint $table): void {
            $table->string('middle_name')->nullable()->after('first_name');
        });
    }

    public function down(): void
    {
        Schema::table('person_names', function (Blueprint $table): void {
            $table->dropColumn('middle_name');
        });
    }
};
