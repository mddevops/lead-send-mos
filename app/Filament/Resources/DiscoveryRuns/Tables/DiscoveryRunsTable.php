<?php

namespace App\Filament\Resources\DiscoveryRuns\Tables;

use Filament\Actions\ViewAction;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class DiscoveryRunsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('run_date')
                    ->label('Дата')
                    ->date('d.m.Y')
                    ->sortable(),
                TextColumn::make('region.name')
                    ->label('Регион')
                    ->searchable()
                    ->sortable(),
                TextColumn::make('query')
                    ->label('Запрос')
                    ->limit(40)
                    ->toggleable(),
                IconColumn::make('only_promo')
                    ->label('Только промо')
                    ->boolean()
                    ->trueIcon('heroicon-o-check-badge')
                    ->falseIcon('heroicon-o-queue-list')
                    ->trueColor('warning')
                    ->falseColor('gray'),
                TextColumn::make('status')
                    ->label('Статус')
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'queued' => 'gray',
                        'processing' => 'info',
                        'completed' => 'success',
                        'failed' => 'danger',
                        default => 'gray',
                    })
                    ->formatStateUsing(fn (string $state): string => match ($state) {
                        'queued' => 'В очереди',
                        'processing' => 'В работе',
                        'completed' => 'Завершён',
                        'failed' => 'Ошибка',
                        default => $state,
                    }),
                TextColumn::make('found_count')
                    ->label('Найдено')
                    ->sortable(),
                TextColumn::make('new_sites_count')
                    ->label('Новых сайтов')
                    ->sortable(),
                TextColumn::make('forms_scanned_count')
                    ->label('Формы: да')
                    ->tooltip('Сайты прогона, у которых уже запускалось сканирование форм')
                    ->sortable(query: function ($query, string $direction) {
                        return $query->orderBy('forms_scanned_count', $direction);
                    })
                    ->placeholder('0'),
                TextColumn::make('forms_not_scanned_count')
                    ->label('Формы: нет')
                    ->tooltip('Сайты прогона со статусом «Новый» — формы ещё не сканировались')
                    ->sortable(query: function ($query, string $direction) {
                        return $query->orderBy('forms_not_scanned_count', $direction);
                    })
                    ->placeholder('0'),
                TextColumn::make('skipped_existing_count')
                    ->label('Уже в базе')
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('skipped_excluded_count')
                    ->label('Исключено')
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('pages_scanned')
                    ->label('Страниц выдачи')
                    ->toggleable(isToggledHiddenByDefault: true),
                IconColumn::make('blocked')
                    ->label('Блокировка')
                    ->boolean()
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('finished_at')
                    ->label('Завершён')
                    ->dateTime('d.m.Y H:i')
                    ->sortable(),
            ])
            ->defaultSort('id', 'desc')
            ->filters([
                SelectFilter::make('region_id')
                    ->label('Регион')
                    ->relationship('region', 'name')
                    ->searchable()
                    ->preload(),
                SelectFilter::make('status')
                    ->label('Статус')
                    ->options([
                        'queued' => 'В очереди',
                        'processing' => 'В работе',
                        'completed' => 'Завершён',
                        'failed' => 'Ошибка',
                    ]),
            ])
            ->recordActions([
                ViewAction::make(),
            ]);
    }
}
