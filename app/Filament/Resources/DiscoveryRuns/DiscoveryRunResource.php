<?php

namespace App\Filament\Resources\DiscoveryRuns;

use App\Filament\Resources\DiscoveryRuns\Pages\ListDiscoveryRuns;
use App\Filament\Resources\DiscoveryRuns\Pages\ViewDiscoveryRun;
use App\Filament\Resources\DiscoveryRuns\RelationManagers\SitesRelationManager;
use App\Filament\Resources\DiscoveryRuns\Tables\DiscoveryRunsTable;
use App\Models\DiscoveryRun;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use UnitEnum;

class DiscoveryRunResource extends Resource
{
    protected static ?string $model = DiscoveryRun::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedMagnifyingGlassCircle;

    protected static ?string $navigationLabel = 'Поиск Яндекс Promo';

    protected static string|UnitEnum|null $navigationGroup = 'Поиск';

    protected static ?string $modelLabel = 'Прогон поиска';

    protected static ?string $pluralModelLabel = 'Прогоны поиска';

    protected static ?int $navigationSort = 10;

    public static function table(Table $table): Table
    {
        return DiscoveryRunsTable::configure($table);
    }

    public static function getRelations(): array
    {
        return [
            SitesRelationManager::class,
        ];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListDiscoveryRuns::route('/'),
            'view' => ViewDiscoveryRun::route('/{record}'),
        ];
    }

    public static function canCreate(): bool
    {
        return false;
    }
}
