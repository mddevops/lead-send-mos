<?php

namespace App\Filament\Resources\Regions\Tables;

use App\Support\DataSyncFilamentActions;
use Filament\Actions\BulkActionGroup;
use Filament\Actions\DeleteBulkAction;
use Filament\Actions\EditAction;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

class RegionsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn ($query) => $query->select([
                'regions.id',
                'regions.name',
                'regions.operator',
                'regions.notes',
                'regions.created_at',
                'regions.updated_at',
            ]))
            ->columns([
                TextColumn::make('name')
                    ->label('Регион')
                    ->searchable(),
                TextColumn::make('operator')
                    ->label('Оператор')
                    ->searchable(),
                TextColumn::make('phone_prefixes_count')
                    ->counts('phonePrefixes')
                    ->label('Диапазонов')
                    ->sortable(),
                TextColumn::make('sites_count')
                    ->counts('sites')
                    ->label('Сайтов')
                    ->sortable(),
                TextColumn::make('created_at')
                    ->label('Создано')
                    ->dateTime()
                    ->sortable(),
            ])
            ->filters([])
            ->recordActions([
                EditAction::make(),
            ])
            ->toolbarActions([
                BulkActionGroup::make([
                    DataSyncFilamentActions::pushSelectedRegionsBulkAction(),
                    DeleteBulkAction::make(),
                ]),
            ]);
    }
}
