<?php

namespace App\Filament\Resources\PersonNames\Pages;

use App\Filament\Resources\PersonNames\PersonNameResource;
use Filament\Resources\Pages\ListRecords;
use Filament\Actions\CreateAction;

class ListPersonNames extends ListRecords
{
    protected static string $resource = PersonNameResource::class;

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make(),
        ];
    }
}
