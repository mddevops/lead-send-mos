<?php

use App\Models\Site;
use App\Support\ParentDomain;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sites', function (Blueprint $table) {
            $table->string('parent_domain', 191)->nullable()->after('url')->index();
        });

        Site::query()->orderBy('id')->chunkById(200, function ($sites): void {
            foreach ($sites as $site) {
                $parent = ParentDomain::fromUrl($site->url);
                if ($parent === null) {
                    continue;
                }
                $site->forceFill(['parent_domain' => $parent])->saveQuietly();
            }
        });

        // Allow mapping_type=sibling (was ENUM auto|manual on MySQL).
        if (Schema::getConnection()->getDriverName() === 'mysql') {
            DB::statement("ALTER TABLE form_mappings MODIFY COLUMN mapping_type VARCHAR(32) NOT NULL DEFAULT 'auto'");
        }
    }

    public function down(): void
    {
        Schema::table('sites', function (Blueprint $table) {
            $table->dropColumn('parent_domain');
        });
    }
};
