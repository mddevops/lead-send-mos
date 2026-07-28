<?php

namespace App\Filament\Resources\PersonNames;

use App\Filament\Resources\PersonNames\Pages\CreatePersonName;
use App\Filament\Resources\PersonNames\Pages\EditPersonName;
use App\Filament\Resources\PersonNames\Pages\ListPersonNames;
use App\Filament\Resources\PersonNames\Schemas\PersonNameForm;
use App\Filament\Resources\PersonNames\Tables\PersonNamesTable;
use App\Models\PersonName;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use UnitEnum;

class PersonNameResource extends Resource
{
    protected static ?string $model = PersonName::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedUserGroup;

    protected static ?string $navigationLabel = 'Имена';

    protected static string|UnitEnum|null $navigationGroup = 'Лиды';

    protected static ?string $modelLabel = 'Имя';

    protected static ?string $pluralModelLabel = 'Имена';

    protected static ?int $navigationSort = 25;

    public static function form(Schema $schema): Schema
    {
        return PersonNameForm::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return PersonNamesTable::configure($table);
    }

    public static function getRelations(): array
    {
        return [];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListPersonNames::route('/'),
            'create' => CreatePersonName::route('/create'),
            'edit' => EditPersonName::route('/{record}/edit'),
        ];
    }
}
