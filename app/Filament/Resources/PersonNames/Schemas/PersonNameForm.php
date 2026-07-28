<?php

namespace App\Filament\Resources\PersonNames\Schemas;

use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Schemas\Schema;

class PersonNameForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                TextInput::make('first_name')
                    ->label('Имя')
                    ->required()
                    ->maxLength(255),
                TextInput::make('middle_name')
                    ->label('Отчество')
                    ->required()
                    ->maxLength(255),
                TextInput::make('last_name')
                    ->label('Фамилия')
                    ->required()
                    ->maxLength(255),
                Select::make('gender')
                    ->label('Пол')
                    ->options([
                        'm' => 'М',
                        'f' => 'Ж',
                    ])
                    ->required(),
            ]);
    }
}
