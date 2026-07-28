<?php

namespace App\Filament\Resources\PersonNames\Pages;

use App\Filament\Resources\PersonNames\PersonNameResource;
use Filament\Resources\Pages\CreateRecord;

class CreatePersonName extends CreateRecord
{
    protected static string $resource = PersonNameResource::class;
}
