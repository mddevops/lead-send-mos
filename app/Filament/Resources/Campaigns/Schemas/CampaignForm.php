<?php

namespace App\Filament\Resources\Campaigns\Schemas;

use Filament\Forms\Components\DateTimePicker;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Schemas\Schema;

class CampaignForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                TextInput::make('name')
                    ->label('Имя')
                    ->required(),
                TextInput::make('phone')
                    ->label('Телефон')
                    ->tel()
                    ->required(),
                Select::make('source')
                    ->label('Источник')
                    ->options([
                        'web' => 'Веб',
                        'telegram' => 'Telegram',
                    ])
                    ->default('web')
                    ->required(),
                Select::make('status')
                    ->label('Статус')
                    ->options([
            'draft' => 'Черновик',
            'queued' => 'В очереди',
            'processing' => 'В обработке',
            'completed' => 'Завершена',
            'completed_with_errors' => 'Завершена с ошибками',
            'failed' => 'Провалена',
            'cancelled' => 'Отменена',
        ])
                    ->default('draft')
                    ->required(),
                TextInput::make('total_sites')
                    ->label('Всего сайтов')
                    ->required()
                    ->numeric()
                    ->default(0),
                TextInput::make('success_count')
                    ->label('Успешно')
                    ->required()
                    ->numeric()
                    ->default(0),
                TextInput::make('failed_count')
                    ->label('Ошибок')
                    ->required()
                    ->numeric()
                    ->default(0),
                TextInput::make('skipped_count')
                    ->label('Пропущено')
                    ->required()
                    ->numeric()
                    ->default(0),
                TextInput::make('unknown_count')
                    ->label('Неизвестно')
                    ->required()
                    ->numeric()
                    ->default(0),
                DateTimePicker::make('started_at')
                    ->label('Начата'),
                DateTimePicker::make('finished_at')
                    ->label('Завершена'),
                Select::make('created_by')
                    ->label('Создал')
                    ->relationship('creator', 'name')
                    ->searchable()
                    ->preload(),
            ]);
    }
}
