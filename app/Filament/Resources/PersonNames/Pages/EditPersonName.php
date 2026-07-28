<?php

namespace App\Filament\Resources\PersonNames\Pages;

use App\Filament\Resources\PersonNames\PersonNameResource;
use Filament\Actions\DeleteAction;
use Filament\Resources\Pages\EditRecord;

class EditPersonName extends EditRecord
{
    protected static string $resource = PersonNameResource::class;

    protected function getHeaderActions(): array
    {
        return [
            DeleteAction::make(),
        ];
    }
}
