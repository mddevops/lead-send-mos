<?php

namespace App\Filament\Resources\CampaignSiteRuns;

use App\Filament\Resources\CampaignSiteRuns\Pages\CreateCampaignSiteRun;
use App\Filament\Resources\CampaignSiteRuns\Pages\EditCampaignSiteRun;
use App\Filament\Resources\CampaignSiteRuns\Pages\ListCampaignSiteRuns;
use App\Filament\Resources\CampaignSiteRuns\Schemas\CampaignSiteRunForm;
use App\Filament\Resources\CampaignSiteRuns\Tables\CampaignSiteRunsTable;
use App\Models\CampaignSiteRun;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use UnitEnum;

class CampaignSiteRunResource extends Resource
{
    protected static ?string $model = CampaignSiteRun::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedRectangleStack;
    protected static ?string $navigationLabel = 'Результаты запусков';
    protected static string|UnitEnum|null $navigationGroup = 'Лиды';
    protected static ?string $modelLabel = 'Результат по сайту';
    protected static ?string $pluralModelLabel = 'Результаты по сайтам';

    public static function form(Schema $schema): Schema
    {
        return CampaignSiteRunForm::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return CampaignSiteRunsTable::configure($table);
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
            'index' => ListCampaignSiteRuns::route('/'),
            'create' => CreateCampaignSiteRun::route('/create'),
            'edit' => EditCampaignSiteRun::route('/{record}/edit'),
        ];
    }
}
