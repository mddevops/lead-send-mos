<?php

namespace App\Console\Commands;

use App\Models\DailyPipelineRun;
use App\Services\DailyPipelineService;
use Illuminate\Console\Command;

class PipelineTickCommand extends Command
{
    protected $signature = 'pipeline:tick';

    protected $description = 'Advance daily Yandex discovery → form scan → submit pipeline';

    public function handle(DailyPipelineService $pipeline): int
    {
        $actives = DailyPipelineRun::query()
            ->whereIn('status', ['pending', 'discovering', 'scanning', 'submitting'])
            ->orderBy('id')
            ->get(['id', 'status', 'submit_cycle_current', 'campaign_id']);

        if ($actives->isEmpty()) {
            $this->info('Pipeline tick: no active runs');
        } else {
            foreach ($actives as $active) {
                $this->line(sprintf(
                    'Pipeline tick: #%d status=%s cycle=%s campaign=%s',
                    $active->id,
                    $active->status,
                    $active->submit_cycle_current ?? 0,
                    $active->campaign_id ?? '-',
                ));
            }
        }

        $pipeline->tick();
        $this->info('Pipeline tick done');

        return self::SUCCESS;
    }
}
