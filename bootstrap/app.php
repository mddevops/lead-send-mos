<?php

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withSchedule(function (Schedule $schedule): void {
        // Do not use withoutOverlapping: a stuck mutex makes schedule:run report
        // "No scheduled commands are ready to run" and freezes scan→submit / next laps.
        $schedule->command('pipeline:tick')
            ->everyMinute()
            ->name('pipeline-tick');

        $schedule->command('proxy:health-check')
            ->everyTenMinutes()
            ->name('proxy-health');
    })
    ->withMiddleware(function (Middleware $middleware): void {
        //
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*'),
        );
    })->create();
