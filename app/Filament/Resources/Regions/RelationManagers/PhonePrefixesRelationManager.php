<?php

namespace App\Filament\Resources\Regions\RelationManagers;

use Filament\Actions\BulkActionGroup;
use Filament\Actions\CreateAction;
use Filament\Actions\DeleteAction;
use Filament\Actions\DeleteBulkAction;
use Filament\Actions\EditAction;
use Filament\Forms\Components\TextInput;
use Filament\Resources\RelationManagers\RelationManager;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

class PhonePrefixesRelationManager extends RelationManager
{
    protected static string $relationship = 'phonePrefixes';

    protected static ?string $title = 'Сетка телефонов';

    public function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('from')
                    ->label('От')
                    ->searchable(),
                TextColumn::make('to')
                    ->label('До')
                    ->searchable(),
                TextColumn::make('operator')
                    ->label('Оператор')
                    ->placeholder('—')
                    ->searchable(),
            ])
            ->defaultPaginationPageOption(20)
            ->paginated([20, 50, 100])
            ->deferLoading()
            ->defaultSort('id')
            ->headerActions([
                CreateAction::make()
                    ->label('Добавить диапазон')
                    ->modalHeading('Добавить диапазон')
                    ->schema($this->prefixForm()),
            ])
            ->recordActions([
                EditAction::make()
                    ->label('Изменить')
                    ->schema($this->prefixForm()),
                DeleteAction::make()->label('Удалить'),
            ])
            ->toolbarActions([
                BulkActionGroup::make([
                    DeleteBulkAction::make(),
                ]),
            ])
            ->emptyStateHeading('Диапазонов пока нет')
            ->emptyStateDescription('Добавьте диапазон или импортируйте Excel: php artisan regions:import-prefixes');
    }

    /**
     * @return array<int, TextInput>
     */
    private function prefixForm(): array
    {
        return [
            TextInput::make('from')
                ->label('От')
                ->required()
                ->placeholder('+7918'),
            TextInput::make('to')
                ->label('До')
                ->required()
                ->placeholder('+7921'),
            TextInput::make('operator')
                ->label('Оператор')
                ->placeholder('Опционально'),
        ];
    }
}
