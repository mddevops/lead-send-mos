<?php

namespace App\Filament\Resources\SiteExclusions;

use App\Filament\Resources\SiteExclusions\Pages\CreateSiteExclusion;
use App\Filament\Resources\SiteExclusions\Pages\EditSiteExclusion;
use App\Filament\Resources\SiteExclusions\Pages\ListSiteExclusions;
use App\Filament\Resources\SiteExclusions\Schemas\SiteExclusionForm;
use App\Filament\Resources\SiteExclusions\Tables\SiteExclusionsTable;
use App\Models\SiteExclusion;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use UnitEnum;

class SiteExclusionResource extends Resource
{
    protected static ?string $model = SiteExclusion::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedNoSymbol;

    protected static ?string $navigationLabel = 'Исключения сайтов';

    protected static string|UnitEnum|null $navigationGroup = 'Поиск';

    protected static ?string $modelLabel = 'Исключение';

    protected static ?string $pluralModelLabel = 'Исключения сайтов';

    protected static ?int $navigationSort = 20;

    public static function form(Schema $schema): Schema
    {
        return SiteExclusionForm::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return SiteExclusionsTable::configure($table);
    }

    public static function getPages(): array
    {
        return [
            'index' => ListSiteExclusions::route('/'),
            'create' => CreateSiteExclusion::route('/create'),
            'edit' => EditSiteExclusion::route('/{record}/edit'),
        ];
    }
}
