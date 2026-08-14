<?php

namespace App\Filament\Resources\Regions\Schemas;

use Filament\Forms\Components\Repeater;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Textarea;
use Filament\Schemas\Schema;

class RegionForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                TextInput::make('name')
                    ->label('Регион')
                    ->required(),
                TextInput::make('operator')
                    ->label('Оператор')
                    ->placeholder('Например: МТС, Билайн'),
                Repeater::make('phone_grid')
                    ->label('Сетка телефонов')
                    ->helperText('Несколько диапазонов для нового региона. Большие списки добавляйте на странице редактирования (по 20 строк) или импортом Excel.')
                    ->schema([
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
                            ->placeholder('Опционально, если отличается'),
                    ])
                    ->columns(3)
                    ->default([
                        ['from' => '+7918', 'to' => '+7921'],
                    ])
                    ->maxItems(50)
                    ->collapsible()
                    ->hiddenOn('edit')
                    ->columnSpanFull(),
                Textarea::make('notes')
                    ->label('Заметки')
                    ->columnSpanFull(),
            ]);
    }
}
