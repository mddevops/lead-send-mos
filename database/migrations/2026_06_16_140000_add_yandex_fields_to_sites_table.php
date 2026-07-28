<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sites', function (Blueprint $table): void {
            $table->string('address')->nullable()->after('url');
            $table->string('phone')->nullable()->after('address');
            $table->string('business_status')->nullable()->after('phone');
            $table->unsignedInteger('rating_count')->nullable()->after('business_status');
            $table->decimal('rating_value', 2, 1)->nullable()->after('rating_count');
        });
    }

    public function down(): void
    {
        Schema::table('sites', function (Blueprint $table): void {
            $table->dropColumn([
                'address',
                'phone',
                'business_status',
                'rating_count',
                'rating_value',
            ]);
        });
    }
};
