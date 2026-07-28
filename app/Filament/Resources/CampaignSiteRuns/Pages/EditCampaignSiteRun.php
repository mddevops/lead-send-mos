<?php

namespace App\Filament\Resources\CampaignSiteRuns\Pages;

use App\Filament\Resources\CampaignSiteRuns\CampaignSiteRunResource;
use Filament\Actions\DeleteAction;
use Filament\Resources\Pages\EditRecord;

class EditCampaignSiteRun extends EditRecord
{
    protected static string $resource = CampaignSiteRunResource::class;

    protected function getHeaderActions(): array
    {
        return [
            DeleteAction::make(),
        ];
    }
}
