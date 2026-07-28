<?php

namespace App\Filament\Resources\FormMappings;

use App\Filament\Resources\FormMappings\Pages\CreateFormMapping;
use App\Filament\Resources\FormMappings\Pages\EditFormMapping;
use App\Filament\Resources\FormMappings\Pages\ListFormMappings;
use App\Filament\Resources\FormMappings\Schemas\FormMappingForm;
use App\Filament\Resources\FormMappings\Tables\FormMappingsTable;
use App\Models\FormMapping;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use UnitEnum;

class FormMappingResource extends Resource
{
    protected static ?string $model = FormMapping::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedRectangleStack;
    protected static ?string $navigationLabel = 'Маппинги форм';
    protected static string|UnitEnum|null $navigationGroup = 'Лиды';
    protected static ?string $modelLabel = 'Маппинг формы';
    protected static ?string $pluralModelLabel = 'Маппинги форм';

    public static function form(Schema $schema): Schema
    {
        return FormMappingForm::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return FormMappingsTable::configure($table);
    }

    public static function getRelations(): array
    {
        return [
            //
        ];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListFormMappings::route('/'),
            'create' => CreateFormMapping::route('/create'),
            'edit' => EditFormMapping::route('/{record}/edit'),
        ];
    }
}
