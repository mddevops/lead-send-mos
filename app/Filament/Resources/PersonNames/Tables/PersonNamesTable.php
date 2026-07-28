<?php

namespace App\Filament\Resources\PersonNames\Tables;

use Filament\Actions\BulkActionGroup;
use Filament\Actions\DeleteBulkAction;
use Filament\Actions\EditAction;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class PersonNamesTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('first_name')
                    ->label('Имя')
                    ->searchable()
                    ->sortable(),
                TextColumn::make('middle_name')
                    ->label('Отчество')
                    ->searchable()
                    ->sortable(),
                TextColumn::make('last_name')
                    ->label('Фамилия')
                    ->searchable()
                    ->sortable(),
                TextColumn::make('gender')
                    ->label('Пол')
                    ->formatStateUsing(fn (string $state): string => $state === 'm' ? 'М' : 'Ж')
                    ->badge()
                    ->sortable(),
            ])
            ->filters([
                SelectFilter::make('gender')
                    ->label('Пол')
                    ->options([
                        'm' => 'М',
                        'f' => 'Ж',
                    ]),
            ])
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
