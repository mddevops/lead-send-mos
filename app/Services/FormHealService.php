<?php

namespace App\Services;

use App\Models\Site;

/**
 * @deprecated Auto-heal after N submit fails removed — sites stay in the submit cycle.
 * Kept as empty stubs so old references do not break.
 */
class FormHealService
{
    public const FAIL_STREAK_LIMIT = 3;

    public const STATUS_PAUSED = 'paused_remap';

    public const STATUS_RESCANNING = 'rescanning';

    public const STATUS_TESTING = 'testing';

    public const STATUS_FAILED = 'failed_heal';

    public function isPausedFromSubmit(Site $site): bool
    {
        return false;
    }

    public function recordSubmitOutcome(Site $site, string $runStatus, bool $isProxyFailure = false): void
    {
        // Disabled: consecutive submit failures no longer pause / rescan the site.
    }

    public function pauseAndRescan(Site $site): void
    {
        // Disabled.
    }

    public function afterScanMappingsSaved(Site $site): void
    {
        // Disabled.
    }

    public function recordHealTestOutcome(Site $site, string $runStatus): void
    {
        // Disabled.
    }
}
