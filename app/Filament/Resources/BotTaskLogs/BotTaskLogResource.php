<?php

namespace App\Filament\Resources\BotTaskLogs;

use App\Filament\Resources\BotTaskLogs\Pages\ListBotTaskLogs;
use App\Filament\Resources\BotTaskLogs\Tables\BotTaskLogsTable;
use App\Models\BotTask;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use UnitEnum;

class BotTaskLogResource extends Resource
{
    protected static ?string $model = BotTask::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedClipboardDocumentList;
    protected static ?string $navigationLabel = 'Логи отправок';
    protected static string|UnitEnum|null $navigationGroup = 'Лиды';
    protected static ?string $modelLabel = 'Лог отправки';
    protected static ?string $pluralModelLabel = 'Логи отправок';

    public static function form(Schema $schema): Schema
    {
        return $schema->components([]);
    }

    public static function table(Table $table): Table
    {
        return BotTaskLogsTable::configure($table);
    }

    public static function getRelations(): array
    {
        return [];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListBotTaskLogs::route('/'),
        ];
    }

    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()
            ->where('type', 'submit_lead')
            ->with(['site', 'campaignSiteRun.campaign', 'campaignSiteRun.proxy'])
            ->latest('id');
    }
}
