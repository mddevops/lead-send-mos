<?php

use App\Models\BotTask;
use App\Models\CampaignSiteRun;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('campaign_site_runs', function (Blueprint $table): void {
            $table->string('phone')->nullable()->after('proxy_id');
        });

        BotTask::query()
            ->where('type', 'submit_lead')
            ->whereNotNull('campaign_site_run_id')
            ->orderBy('id')
            ->chunkById(200, function ($tasks): void {
                foreach ($tasks as $task) {
                    $phone = trim((string) (($task->payload['phone'] ?? '')));
                    if ($phone === '') {
                        continue;
                    }

                    CampaignSiteRun::query()
                        ->where('id', $task->campaign_site_run_id)
                        ->where(function ($query): void {
                            $query->whereNull('phone')->orWhere('phone', '');
                        })
                        ->update(['phone' => $phone]);
                }
            });
    }

    public function down(): void
    {
        Schema::table('campaign_site_runs', function (Blueprint $table): void {
            $table->dropColumn('phone');
        });
    }
};
