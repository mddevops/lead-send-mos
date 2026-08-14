<?php

namespace App\Filament\Resources\CampaignSiteRuns\Schemas;

use Filament\Forms\Components\DateTimePicker;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Textarea;
use Filament\Schemas\Schema;

class CampaignSiteRunForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Select::make('campaign_id')
                    ->label('Кампания')
                    ->relationship('campaign', 'name')
                    ->required(),
                Select::make('site_id')
                    ->label('Сайт')
                    ->relationship('site', 'name')
                    ->required(),
                Select::make('proxy_id')
                    ->label('Прокси')
                    ->relationship('proxy', 'name'),
                TextInput::make('phone')
                    ->label('Телефон (введённый)'),
                Select::make('status')
                    ->label('Статус')
                    ->options([
            'pending' => 'Ожидание',
            'processing' => 'В обработке',
            'success' => 'Успех',
            'failed' => 'Ошибка',
            'skipped' => 'Пропущен',
            'unknown' => 'Неизвестно',
        ])
                    ->default('pending')
                    ->required(),
                TextInput::make('skip_reason')
                    ->label('Причина пропуска'),
                Textarea::make('error_message')
                    ->label('Сообщение об ошибке')
                    ->columnSpanFull(),
                Textarea::make('response_text')
                    ->label('Текст ответа')
                    ->columnSpanFull(),
                TextInput::make('response_url')
                    ->label('URL ответа')
                    ->url(),
                TextInput::make('http_status')
                    ->label('HTTP статус')
                    ->numeric(),
                TextInput::make('detected_success_reason')
                    ->label('Причина успеха'),
                TextInput::make('detected_error_reason')
                    ->label('Причина ошибки'),
                TextInput::make('screenshot_before')
                    ->label('Скриншот до'),
                TextInput::make('screenshot_after')
                    ->label('Скриншот после'),
                DateTimePicker::make('started_at')
                    ->label('Начато'),
                DateTimePicker::make('finished_at')
                    ->label('Завершено'),
                TextInput::make('duration_ms')
                    ->label('Длительность (мс)')
                    ->numeric(),
            ]);
    }
}
