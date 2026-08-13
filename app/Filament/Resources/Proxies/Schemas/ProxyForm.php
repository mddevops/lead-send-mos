<?php

namespace App\Filament\Resources\Proxies\Schemas;

use Filament\Forms\Components\DateTimePicker;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Textarea;
use Filament\Schemas\Schema;

class ProxyForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                TextInput::make('name')
                    ->label('Название')
                    ->required(),
                TextInput::make('provider')
                    ->label('Провайдер'),
                Select::make('type')
                    ->label('Тип')
                    ->options(['mobile' => 'Мобильный', 'residential' => 'Резидентский', 'datacenter' => 'Дата-центр'])
                    ->required(),
                TextInput::make('host')
                    ->label('Хост')
                    ->required(),
                TextInput::make('port')
                    ->label('Порт')
                    ->required()
                    ->numeric(),
                TextInput::make('username')
                    ->label('Логин'),
                TextInput::make('password')
                    ->label('Пароль')
                    ->password()
                    ->revealable()
                    ->dehydrated(fn (?string $state): bool => filled($state)),
                TextInput::make('change_ip_url')
                    ->label('URL смены IP')
                    ->url(),
                Select::make('status')
                    ->label('Статус')
                    ->options(['active' => 'Активен', 'disabled' => 'Отключён', 'cooldown' => 'На паузе', 'failed' => 'Ошибка'])
                    ->default('active')
                    ->required(),
                DateTimePicker::make('last_used_at')
                    ->label('Последнее использование'),
                DateTimePicker::make('cooldown_until')
                    ->label('Пауза до'),
                TextInput::make('last_ip')
                    ->label('Последний IP'),
                Textarea::make('notes')
                    ->label('Заметки')
                    ->columnSpanFull(),
            ]);
    }
}
