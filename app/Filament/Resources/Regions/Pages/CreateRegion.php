<?php

namespace App\Filament\Resources\Regions\Pages;

use App\Filament\Resources\Regions\RegionResource;
use Filament\Resources\Pages\CreateRecord;

class CreateRegion extends CreateRecord
{
    protected static string $resource = RegionResource::class;

    /** @var list<array<string, mixed>> */
    private array $pendingPhoneGrid = [];

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    protected function mutateFormDataBeforeCreate(array $data): array
    {
        $this->pendingPhoneGrid = is_array($data['phone_grid'] ?? null) ? $data['phone_grid'] : [];
        $data['phone_grid'] = null;

        return $data;
    }

    protected function afterCreate(): void
    {
        $this->record->syncPhonePrefixesFromGrid($this->pendingPhoneGrid);
    }
}
