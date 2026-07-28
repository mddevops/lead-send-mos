<?php

namespace App\Filament\Resources\Proxies;

use App\Filament\Resources\Proxies\Pages\CreateProxy;
use App\Filament\Resources\Proxies\Pages\EditProxy;
use App\Filament\Resources\Proxies\Pages\ListProxies;
use App\Filament\Resources\Proxies\Schemas\ProxyForm;
use App\Filament\Resources\Proxies\Tables\ProxiesTable;
use App\Models\Proxy;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use UnitEnum;

class ProxyResource extends Resource
{
    protected static ?string $model = Proxy::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedRectangleStack;
    protected static ?string $navigationLabel = 'Прокси';
    protected static string|UnitEnum|null $navigationGroup = 'Лиды';
    protected static ?string $modelLabel = 'Прокси';
    protected static ?string $pluralModelLabel = 'Прокси';

    public static function form(Schema $schema): Schema
    {
        return ProxyForm::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return ProxiesTable::configure($table);
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
            'index' => ListProxies::route('/'),
            'create' => CreateProxy::route('/create'),
            'edit' => EditProxy::route('/{record}/edit'),
        ];
    }
}
