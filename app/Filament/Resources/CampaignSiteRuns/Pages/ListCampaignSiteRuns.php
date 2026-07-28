<?php

namespace App\Filament\Resources\CampaignSiteRuns\Pages;

use App\Filament\Resources\CampaignSiteRuns\CampaignSiteRunResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ListRecords;

class ListCampaignSiteRuns extends ListRecords
{
    protected static string $resource = CampaignSiteRunResource::class;

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make(),
        ];
    }
}
