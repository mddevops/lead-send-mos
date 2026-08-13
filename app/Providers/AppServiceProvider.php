<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Filament UI (List / New / Edit / Save changes) follows app locale.
        $locale = config('app.locale', 'ru');
        app()->setLocale(is_string($locale) && $locale !== '' ? $locale : 'ru');
    }
}
