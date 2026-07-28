<?php

namespace App\Filament\Resources\Campaigns\Tables;

use Filament\Actions\BulkActionGroup;
use Filament\Actions\DeleteBulkAction;
use Filament\Actions\EditAction;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

class CampaignsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('name')
                    ->label('Имя')
                    ->searchable(),
                TextColumn::make('phone')
                    ->label('Телефон')
                    ->searchable(),
                TextColumn::make('source')
                    ->label('Источник')
                    ->badge()
                    ->formatStateUsing(fn (string $state): string => $state === 'telegram' ? 'Telegram' : 'Web'),
                TextColumn::make('status')
                    ->label('Статус')
                    ->badge(),
                TextColumn::make('total_sites')
                    ->label('Всего сайтов')
                    ->numeric()
                    ->sortable(),
                TextColumn::make('success_count')
                    ->label('Успешно')
                    ->numeric()
                    ->sortable(),
                TextColumn::make('failed_count')
                    ->label('Ошибок')
                    ->numeric()
                    ->sortable(),
                TextColumn::make('skipped_count')
                    ->label('Пропущено')
                    ->numeric()
                    ->sortable(),
                TextColumn::make('unknown_count')
                    ->label('Неизвестно')
                    ->numeric()
                    ->sortable(),
                TextColumn::make('started_at')
                    ->label('Начата')
                    ->dateTime()
                    ->sortable(),
                TextColumn::make('finished_at')
                    ->label('Завершена')
                    ->dateTime()
                    ->sortable(),
                TextColumn::make('creator.name')
                    ->label('Создал')
                    ->searchable()
                    ->sortable(),
                TextColumn::make('created_at')
                    ->label('Создано')
                    ->dateTime()
                    ->sortable()
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('updated_at')
                    ->label('Обновлено')
                    ->dateTime()
                    ->sortable()
                    ->toggleable(isToggledHiddenByDefault: true),
            ])
            ->filters([
                SelectFilter::make('source')
                    ->label('Источник')
                    ->options([
                        'web' => 'Web',
                        'telegram' => 'Telegram',
                    ]),
                SelectFilter::make('status')
                    ->label('Статус')
                    ->options([
                        'draft' => 'Черновик',
                        'queued' => 'В очереди',
                        'processing' => 'В обработке',
                        'completed' => 'Завершена',
                        'completed_with_errors' => 'Завершена с ошибками',
                        'failed' => 'Провалена',
                        'cancelled' => 'Отменена',
                    ]),
            ])
            ->recordActions([
                EditAction::make()->label('Детали'),
            ])
            ->toolbarActions([
                BulkActionGroup::make([
                    DeleteBulkAction::make(),
                ]),
            ]);
    }
}
