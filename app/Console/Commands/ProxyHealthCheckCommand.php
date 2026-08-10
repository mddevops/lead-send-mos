<?php

namespace App\Console\Commands;

use App\Models\Proxy;
use App\Services\DailyPipelineService;
use App\Services\ProxyHealthChecker;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class ProxyHealthCheckCommand extends Command
{
    protected $signature = 'proxy:health-check';

    protected $description = 'Check proxies every 10 minutes: enable working, disable dead; pause/resume pipelines';

    public function handle(ProxyHealthChecker $checker, DailyPipelineService $pipelines): int
    {
        set_time_limit(0);

        $proxies = $checker->proxiesForScheduledCheck();

        if ($proxies->isEmpty()) {
            $this->info('No proxies to check.');
            $pipelines->pauseActivePipelinesForNoProxy();

            return self::SUCCESS;
        }

        $report = $checker->checkAndDisableDead($proxies);

        $this->info(sprintf(
            'Checked %d · working %d · disabled %d',
            $report['checked'],
            count($report['working']),
            $report['disabled'],
        ));

        Log::info('proxy.health_check', [
            'checked' => $report['checked'],
            'working' => count($report['working']),
            'disabled' => $report['disabled'],
        ]);

        $hasActive = Proxy::query()->where('status', 'active')->exists();

        if ($hasActive) {
            $resumed = $pipelines->resumePausedForProxy();
            if ($resumed > 0) {
                $this->info("Resumed {$resumed} paused pipeline(s).");
            }
        } else {
            $paused = $pipelines->pauseActivePipelinesForNoProxy();
            if ($paused > 0) {
                $this->warn("Paused {$paused} pipeline(s): no working proxies.");
            }
        }

        return self::SUCCESS;
    }
}
