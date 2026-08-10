<?php

use App\Http\Controllers\Api\BotWebhookController;
use App\Http\Controllers\Api\DataSyncController;
use App\Http\Controllers\Api\ExtensionImportController;
use App\Http\Controllers\Api\TelegramWebhookController;
use App\Http\Middleware\BotApiTokenMiddleware;
use Illuminate\Support\Facades\Route;

Route::prefix('bot')
    ->middleware(BotApiTokenMiddleware::class)
    ->group(function (): void {
        Route::get('/runtime-config', [BotWebhookController::class, 'runtimeConfig']);
        Route::post('/runtime-config', [BotWebhookController::class, 'runtimeConfig']);
        Route::post('/tasks/claim', [BotWebhookController::class, 'claimTask']);
        Route::post('/tasks/{task}/started', [BotWebhookController::class, 'taskStarted']);
        Route::post('/tasks/{task}/completed', [BotWebhookController::class, 'taskCompleted']);
        Route::post('/tasks/{task}/failed', [BotWebhookController::class, 'taskFailed']);
        Route::post('/sites/{site}/mapping', [BotWebhookController::class, 'siteMapping']);
        Route::post('/sites/{site}/mappings/bulk', [BotWebhookController::class, 'siteMappingsBulk']);
        Route::post('/campaign-runs/{run}/result', [BotWebhookController::class, 'campaignRunResult']);
        Route::post('/discovery-runs/{run}/result', [BotWebhookController::class, 'discoveryRunResult']);
        Route::post('/screenshots', [BotWebhookController::class, 'storeScreenshot']);
        Route::get('/extension/meta', [ExtensionImportController::class, 'meta']);
        Route::post('/extension/import', [ExtensionImportController::class, 'import']);

        // Cross-environment sync (local ↔ meterorix.com)
        Route::get('/sync/sites', [DataSyncController::class, 'exportSites']);
        Route::post('/sync/sites', [DataSyncController::class, 'importSites']);
        Route::get('/sync/proxies', [DataSyncController::class, 'exportProxies']);
        Route::post('/sync/proxies', [DataSyncController::class, 'importProxies']);
        Route::get('/sync/daily-pipeline-runs', [DataSyncController::class, 'exportPipelines']);
        Route::get('/sync/daily-pipeline-runs/{pipeline}', [DataSyncController::class, 'exportPipeline']);
        Route::post('/sync/daily-pipeline-runs', [DataSyncController::class, 'importPipelines']);
    });

Route::post('/telegram/webhook/{secret}', TelegramWebhookController::class);
