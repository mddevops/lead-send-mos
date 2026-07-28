<?php

namespace App\Filament\Resources\SiteExclusions\Pages;

use App\Filament\Resources\SiteExclusions\SiteExclusionResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ListRecords;

class ListSiteExclusions extends ListRecords
{
    protected static string $resource = SiteExclusionResource::class;

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make(),
        ];
    }
}
