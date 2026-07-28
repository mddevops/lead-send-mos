<?php

namespace App\Console\Commands;

use App\Services\DailyPipelineService;
use Illuminate\Console\Command;
use Throwable;

class PipelineStartCommand extends Command
{
    protected $signature = 'pipeline:start {--query= : Override search query}';

    protected $description = 'Manually start daily pipeline now';

    public function handle(DailyPipelineService $pipeline): int
    {
        try {
            $run = $pipeline->startNow($this->option('query') ?: null);
            $this->info("Pipeline #{$run->id} started ({$run->query})");

            return self::SUCCESS;
        } catch (Throwable $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
    }
}
