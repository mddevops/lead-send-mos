<?php

namespace App\Filament\Resources\Regions\Tables;

use App\Models\Region;
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
            ->columns([
                TextColumn::make('name')
                    ->label('Регион')
                    ->searchable(),
                TextColumn::make('operator')
                    ->label('Оператор')
                    ->searchable(),
                TextColumn::make('phone_grid')
                    ->label('Сетка')
                    ->formatStateUsing(fn ($state, Region $record): string => $record->formatPhoneGridPreview())
                    ->wrap(),
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
                    DeleteBulkAction::make(),
                ]),
            ]);
    }
}
