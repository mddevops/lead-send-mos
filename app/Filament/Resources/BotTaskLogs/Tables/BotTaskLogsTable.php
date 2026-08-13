<?php

namespace App\Filament\Resources\BotTaskLogs\Tables;

use App\Models\Proxy;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;

class BotTaskLogsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('id')
                    ->label('Задача №')
                    ->sortable(),
                TextColumn::make('status')
                    ->label('Статус задачи')
                    ->badge()
                    ->formatStateUsing(fn (?string $state): string => match ($state) {
                        'queued' => 'В очереди',
                        'processing' => 'В обработке',
                        'completed' => 'Завершена',
                        'failed' => 'Ошибка',
                        default => $state ?? '—',
                    }),
                TextColumn::make('site.name')
                    ->label('Сайт')
                    ->searchable(),
                TextColumn::make('campaignSiteRun.campaign.phone')
                    ->label('Телефон')
                    ->searchable(),
                TextColumn::make('campaignSiteRun.campaign.source')
                    ->label('Источник')
                    ->badge()
                    ->formatStateUsing(fn (?string $state): string => $state === 'telegram' ? 'Telegram' : 'Веб'),
                TextColumn::make('campaignSiteRun.status')
                    ->label('Статус отправки')
                    ->badge()
                    ->formatStateUsing(fn (?string $state): string => match ($state) {
                        'pending' => 'Ожидание',
                        'processing' => 'В обработке',
                        'success' => 'Успех',
                        'failed' => 'Ошибка',
                        'unknown' => 'Неизвестно',
                        'skipped' => 'Пропущен',
                        default => $state ?? '—',
                    }),
                TextColumn::make('proxy')
                    ->label('Прокси')
                    ->formatStateUsing(fn ($state, $record): string => $record->campaignSiteRun?->proxy
                        ? ($record->campaignSiteRun->proxy->host.':'.$record->campaignSiteRun->proxy->port)
                        : '—')
                    ->searchable(query: function (Builder $query, string $search): Builder {
                        return $query->whereHas('campaignSiteRun.proxy', fn (Builder $proxy) => $proxy->where('host', 'like', "%{$search}%"));
                    }),
                TextColumn::make('campaignSiteRun.http_status')
                    ->label('HTTP')
                    ->sortable(),
                TextColumn::make('campaignSiteRun.detected_success_reason')
                    ->label('Успех')
                    ->limit(24)
                    ->tooltip(fn (?string $state): ?string => $state),
                TextColumn::make('campaignSiteRun.detected_error_reason')
                    ->label('Ошибка детекта')
                    ->limit(24)
                    ->tooltip(fn (?string $state): ?string => $state),
                TextColumn::make('error_message')
                    ->label('Ошибка задачи')
                    ->limit(36)
                    ->tooltip(fn (?string $state): ?string => $state),
                TextColumn::make('campaignSiteRun.error_message')
                    ->label('Ошибка отправки')
                    ->limit(36)
                    ->tooltip(fn (?string $state): ?string => $state),
                TextColumn::make('created_at')
                    ->label('Создано')
                    ->dateTime()
                    ->sortable(),
                TextColumn::make('started_at')
                    ->label('Старт')
                    ->dateTime()
                    ->sortable(),
                TextColumn::make('finished_at')
                    ->label('Финиш')
                    ->dateTime()
                    ->sortable(),
                TextColumn::make('duration_ms')
                    ->label('Длительность, мс')
                    ->sortable(),
            ])
            ->filters([
                SelectFilter::make('status')
                    ->label('Статус задачи')
                    ->options([
                        'queued' => 'В очереди',
                        'processing' => 'В обработке',
                        'completed' => 'Завершена',
                        'failed' => 'Ошибка',
                    ]),
                SelectFilter::make('run_status')
                    ->label('Статус отправки')
                    ->options([
                        'pending' => 'Ожидание',
                        'processing' => 'В обработке',
                        'success' => 'Успех',
                        'failed' => 'Ошибка',
                        'unknown' => 'Неизвестно',
                        'skipped' => 'Пропущен',
                    ])
                    ->query(fn (Builder $query, array $data) => $query->when(
                        filled($data['value'] ?? null),
                        fn (Builder $q) => $q->whereHas('campaignSiteRun', fn (Builder $run) => $run->where('status', $data['value']))
                    )),
                SelectFilter::make('site_id')
                    ->label('Сайт')
                    ->relationship('site', 'name')
                    ->searchable()
                    ->preload(),
                SelectFilter::make('source')
                    ->label('Источник')
                    ->options([
                        'web' => 'Веб',
                        'telegram' => 'Telegram',
                    ])
                    ->query(fn (Builder $query, array $data) => $query->when(
                        filled($data['value'] ?? null),
                        fn (Builder $q) => $q->whereHas(
                            'campaignSiteRun.campaign',
                            fn (Builder $campaign) => $campaign->where('source', $data['value'])
                        )
                    )),
                SelectFilter::make('proxy_id')
                    ->label('Прокси')
                    ->options(fn (): array => Proxy::query()->orderBy('name')->pluck('name', 'id')->all())
                    ->query(fn (Builder $query, array $data) => $query->when(
                        filled($data['value'] ?? null),
                        fn (Builder $q) => $q->whereHas('campaignSiteRun', fn (Builder $run) => $run->where('proxy_id', (int) $data['value']))
                    )),
            ])
            ->recordActions([])
            ->toolbarActions([]);
    }
}
