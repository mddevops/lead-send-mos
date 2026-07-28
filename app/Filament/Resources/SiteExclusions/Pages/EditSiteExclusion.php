<?php

namespace App\Filament\Resources\SiteExclusions\Pages;

use App\Filament\Resources\SiteExclusions\SiteExclusionResource;
use Filament\Actions\DeleteAction;
use Filament\Resources\Pages\EditRecord;

class EditSiteExclusion extends EditRecord
{
    protected static string $resource = SiteExclusionResource::class;

    protected function getHeaderActions(): array
    {
        return [
            DeleteAction::make(),
        ];
    }
}
