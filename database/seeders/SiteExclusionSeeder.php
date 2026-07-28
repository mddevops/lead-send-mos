<?php

namespace Database\Seeders;

use App\Models\SiteExclusion;
use App\Services\YandexAdsDiscoveryService;
use Illuminate\Database\Seeder;

class SiteExclusionSeeder extends Seeder
{
    public function run(): void
    {
        foreach (YandexAdsDiscoveryService::defaultExcludedDomains() as $domain) {
            SiteExclusion::query()->firstOrCreate(
                ['domain' => $domain],
                ['note' => 'Системное исключение', 'is_active' => true],
            );
        }
    }
}
