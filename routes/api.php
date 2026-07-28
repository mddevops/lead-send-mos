<?php

use App\Http\Controllers\Api\BotWebhookController;
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
    });

Route::post('/telegram/webhook/{secret}', TelegramWebhookController::class);
