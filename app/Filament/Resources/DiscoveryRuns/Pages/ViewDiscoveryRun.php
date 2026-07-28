<?php

namespace App\Filament\Resources\DiscoveryRuns\Pages;

use App\Filament\Resources\DiscoveryRuns\DiscoveryRunResource;
use Filament\Infolists\Components\TextEntry;
use Filament\Resources\Pages\ViewRecord;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class ViewDiscoveryRun extends ViewRecord
{
    protected static string $resource = DiscoveryRunResource::class;

    public function infolist(Schema $schema): Schema
    {
        return $schema->components([
            Section::make('Параметры прогона')
                ->schema([
                    TextEntry::make('run_date')->label('Дата')->date('d.m.Y'),
                    TextEntry::make('region.name')->label('Регион'),
                    TextEntry::make('query')->label('Поисковый запрос')->columnSpanFull(),
                    TextEntry::make('status')
                        ->label('Статус')
                        ->badge()
                        ->formatStateUsing(fn (string $state): string => match ($state) {
                            'queued' => 'В очереди',
                            'processing' => 'В работе',
                            'completed' => 'Завершён',
                            'failed' => 'Ошибка',
                            default => $state,
                        })
                        ->color(fn (string $state): string => match ($state) {
                            'queued' => 'gray',
                            'processing' => 'info',
                            'completed' => 'success',
                            'failed' => 'danger',
                            default => 'gray',
                        }),
                    TextEntry::make('pages_scanned')->label('Страниц выдачи')->placeholder('—'),
                    TextEntry::make('found_count')->label('Найдено объявлений'),
                    TextEntry::make('new_sites_count')->label('Добавлено сайтов'),
                    TextEntry::make('skipped_existing_count')->label('Уже были в базе'),
                    TextEntry::make('skipped_excluded_count')->label('Исключённые домены'),
                    TextEntry::make('blocked')
                        ->label('Блокировка / капча')
                        ->formatStateUsing(fn ($state): string => $state ? 'Да' : 'Нет'),
                    TextEntry::make('bot_task_id')->label('ID задачи бота')->placeholder('—'),
                    TextEntry::make('started_at')->label('Начат')->dateTime('d.m.Y H:i')->placeholder('—'),
                    TextEntry::make('finished_at')->label('Завершён')->dateTime('d.m.Y H:i')->placeholder('—'),
                    TextEntry::make('error_message')
                        ->label('Сообщение об ошибке')
                        ->placeholder('—')
                        ->columnSpanFull(),
                ])
                ->columns(3),
        ]);
    }
}
