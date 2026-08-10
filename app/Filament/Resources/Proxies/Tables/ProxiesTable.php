<?php

namespace App\Filament\Resources\Proxies\Tables;

use App\Models\Proxy;
use App\Support\DataSyncFilamentActions;
use Filament\Actions\BulkAction;
use Filament\Actions\BulkActionGroup;
use Filament\Actions\DeleteBulkAction;
use Filament\Actions\EditAction;
use Filament\Notifications\Notification;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Collection;

class ProxiesTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('name')
                    ->label('Название')
                    ->searchable(),
                TextColumn::make('provider')
                    ->label('Провайдер')
                    ->searchable(),
                TextColumn::make('type')
                    ->label('Тип')
                    ->badge()
                    ->formatStateUsing(fn (?string $state): string => match ($state) {
                        'mobile' => 'Мобильный',
                        'residential' => 'Резидентский',
                        'datacenter' => 'Дата-центр',
                        default => (string) $state,
                    }),
                TextColumn::make('host')
                    ->label('Хост')
                    ->searchable(),
                TextColumn::make('port')
                    ->label('Порт')
                    ->numeric()
                    ->sortable(),
                TextColumn::make('username')
                    ->label('Логин')
                    ->searchable(),
                TextColumn::make('change_ip_url')
                    ->label('URL смены IP')
                    ->searchable()
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('status')
                    ->label('Статус')
                    ->badge()
                    ->formatStateUsing(fn (?string $state): string => match ($state) {
                        'active' => 'Активен',
                        'disabled' => 'Отключён',
                        'cooldown' => 'На паузе',
                        'failed' => 'Ошибка',
                        default => (string) $state,
                    })
                    ->color(fn (?string $state): string => match ($state) {
                        'active' => 'success',
                        'disabled' => 'danger',
                        'cooldown' => 'warning',
                        'failed' => 'danger',
                        default => 'gray',
                    }),
                TextColumn::make('last_used_at')
                    ->label('Последнее использование')
                    ->dateTime()
                    ->sortable(),
                TextColumn::make('cooldown_until')
                    ->label('Пауза до')
                    ->dateTime()
                    ->sortable()
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('last_ip')
                    ->label('Последний IP')
                    ->searchable(),
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
                //
            ])
            ->recordActions([
                EditAction::make(),
            ])
            ->toolbarActions([
                BulkActionGroup::make([
                    DataSyncFilamentActions::pushSelectedProxiesBulkAction(),
                    BulkAction::make('activate')
                        ->label('Активировать')
                        ->icon('heroicon-o-check-circle')
                        ->color('success')
                        ->requiresConfirmation()
                        ->deselectRecordsAfterCompletion()
                        ->action(function (Collection $records): void {
                            $n = 0;
                            foreach ($records as $record) {
                                /** @var Proxy $record */
                                $record->update([
                                    'status' => 'active',
                                    'cooldown_until' => null,
                                ]);
                                $n++;
                            }

                            Notification::make()
                                ->title("Активировано: {$n}")
                                ->success()
                                ->send();
                        }),
                    BulkAction::make('disable')
                        ->label('Отключить')
                        ->icon('heroicon-o-x-circle')
                        ->color('danger')
                        ->requiresConfirmation()
                        ->deselectRecordsAfterCompletion()
                        ->action(function (Collection $records): void {
                            $n = 0;
                            foreach ($records as $record) {
                                /** @var Proxy $record */
                                $record->update([
                                    'status' => 'disabled',
                                    'cooldown_until' => null,
                                ]);
                                $n++;
                            }

                            Notification::make()
                                ->title("Отключено: {$n}")
                                ->success()
                                ->send();
                        }),
                    DeleteBulkAction::make(),
                ]),
            ]);
    }
}
