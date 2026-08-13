<?php

namespace App\Filament\Resources\Sites\Schemas;

use Filament\Forms\Components\DateTimePicker;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\Toggle;
use Filament\Schemas\Schema;

class SiteForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                TextInput::make('name')
                    ->label('Название')
                    ->required(),
                Select::make('region_id')
                    ->label('Регион')
                    ->relationship('region', 'name')
                    ->searchable()
                    ->preload(),
                TextInput::make('url')
                    ->label('URL сайта')
                    ->helperText('Чистый адрес без UTM (например https://example.ru)')
                    ->url()
                    ->required(),
                Textarea::make('ad_url')
                    ->label('Рекламная ссылка')
                    ->helperText('Полная ссылка из объявления с UTM / трекингом')
                    ->rows(2)
                    ->columnSpanFull(),
                TextInput::make('address')
                    ->label('Адрес')
                    ->maxLength(500),
                TextInput::make('phone')
                    ->label('Телефон')
                    ->tel()
                    ->maxLength(50),
                Select::make('status')
                    ->label('Статус')
                    ->options([
            'new' => 'Новый',
            'scanning' => 'Сканирование',
            'ready' => 'Готов',
            'needs_manual_mapping' => 'Нужна ручная настройка',
            'mapping_failed' => 'Ошибка маппинга',
            'disabled' => 'Отключён',
        ])
                    ->default('new')
                    ->required(),
                Toggle::make('is_promo')
                    ->label('Промо (реклама)')
                    ->helperText('Сайт из рекламного блока Яндекса. Выкл — органика.')
                    ->default(true),
                DateTimePicker::make('last_scan_at')
                    ->label('Последнее сканирование'),
            ]);
    }
}
