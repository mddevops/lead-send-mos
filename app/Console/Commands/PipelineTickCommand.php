<?php

namespace App\Console\Commands;

use App\Services\DailyPipelineService;
use Illuminate\Console\Command;

class PipelineTickCommand extends Command
{
    protected $signature = 'pipeline:tick';

    protected $description = 'Advance daily Yandex discovery → form scan → submit pipeline';

    public function handle(DailyPipelineService $pipeline): int
    {
        $pipeline->tick();
        $this->info('Pipeline tick done');

        return self::SUCCESS;
    }
}
