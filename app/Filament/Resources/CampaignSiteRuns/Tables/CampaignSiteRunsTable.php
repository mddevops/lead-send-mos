<?php

namespace App\Filament\Resources\CampaignSiteRuns\Tables;

use Filament\Actions\BulkActionGroup;
use Filament\Actions\DeleteBulkAction;
use Filament\Actions\EditAction;
use Filament\Forms\Components\DatePicker;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Tables\Filters\Filter;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;

class CampaignSiteRunsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('campaign.name')
                    ->label('Кампания')
                    ->searchable(),
                TextColumn::make('phone')
                    ->label('Телефон')
                    ->getStateUsing(function ($record): string {
                        $fromRun = trim((string) ($record->phone ?? ''));
                        if ($fromRun !== '') {
                            return $fromRun;
                        }

                        return trim((string) ($record->campaign?->phone ?? '')) ?: '—';
                    })
                    ->searchable(query: function (Builder $query, string $search): Builder {
                        $like = '%'.$search.'%';

                        return $query->where(function (Builder $inner) use ($like): void {
                            $inner
                                ->where('phone', 'like', $like)
                                ->orWhereHas('campaign', fn (Builder $campaign) => $campaign->where('phone', 'like', $like));
                        });
                    }),
                TextColumn::make('site.url')
                    ->label('Сайт')
                    ->searchable()
                    ->limit(40)
                    ->tooltip(fn (?string $state): ?string => $state),
                TextColumn::make('proxy.name')
                    ->label('Прокси')
                    ->searchable(),
                TextColumn::make('status')
                    ->label('Статус')
                    ->badge(),
                TextColumn::make('skip_reason')
                    ->label('Причина пропуска')
                    ->searchable(),
                TextColumn::make('response_url')
                    ->label('URL ответа')
                    ->searchable(),
                TextColumn::make('response_text')
                    ->label('Текст ответа')
                    ->limit(60)
                    ->tooltip(fn (?string $state): ?string => $state),
                TextColumn::make('http_status')
                    ->label('HTTP статус')
                    ->numeric()
                    ->sortable(),
                TextColumn::make('error_message')
                    ->label('Ошибка')
                    ->limit(40)
                    ->tooltip(fn (?string $state): ?string => $state),
                TextColumn::make('detected_success_reason')
                    ->label('Причина успеха')
                    ->searchable(),
                TextColumn::make('detected_error_reason')
                    ->label('Причина ошибки')
                    ->searchable(),
                TextColumn::make('screenshot_before')
                    ->label('Скриншот до')
                    ->formatStateUsing(fn (?string $state): string => filled($state) ? 'Открыть (через карточку записи)' : '-'),
                TextColumn::make('screenshot_after')
                    ->label('Скриншот после')
                    ->formatStateUsing(fn (?string $state): string => filled($state) ? 'Открыть (через карточку записи)' : '-'),
                TextColumn::make('started_at')
                    ->label('Начато')
                    ->dateTime()
                    ->sortable(),
                TextColumn::make('finished_at')
                    ->label('Завершено')
                    ->dateTime()
                    ->sortable(),
                TextColumn::make('duration_ms')
                    ->label('Длительность (мс)')
                    ->numeric()
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
                SelectFilter::make('status')
                    ->label('Статус')
                    ->options([
                        'success' => 'Успех',
                        'failed' => 'Ошибка',
                        'skipped' => 'Пропущен',
                        'unknown' => 'Неизвестно',
                        'pending' => 'Ожидание',
                        'processing' => 'В обработке',
                    ]),
                SelectFilter::make('site_id')
                    ->label('Сайт')
                    ->relationship('site', 'name')
                    ->searchable()
                    ->preload(),
                SelectFilter::make('campaign_id')
                    ->label('Кампания')
                    ->relationship('campaign', 'name')
                    ->searchable()
                    ->preload(),
                Filter::make('phone')
                    ->label('Телефон')
                    ->form([
                        TextInput::make('phone')
                            ->label('Телефон'),
                    ])
                    ->query(function (Builder $query, array $data): Builder {
                        $phone = trim((string) ($data['phone'] ?? ''));

                        return $query->when($phone !== '', function (Builder $q) use ($phone): Builder {
                            $like = '%'.$phone.'%';

                            return $q->where(function (Builder $inner) use ($like): void {
                                $inner
                                    ->where('phone', 'like', $like)
                                    ->orWhereHas('botTasks', fn (Builder $task) => $task->where('payload->phone', 'like', $like))
                                    ->orWhereHas('campaign', fn (Builder $campaign) => $campaign->where('phone', 'like', $like));
                            });
                        });
                    }),
                Filter::make('date_range')
                    ->label('Период')
                    ->form([
                        DatePicker::make('from')->label('С даты'),
                        DatePicker::make('until')->label('По дату'),
                    ])
                    ->query(function (Builder $query, array $data): Builder {
                        return $query
                            ->when($data['from'] ?? null, fn (Builder $q, $date) => $q->whereDate('created_at', '>=', $date))
                            ->when($data['until'] ?? null, fn (Builder $q, $date) => $q->whereDate('created_at', '<=', $date));
                    }),
            ])
            ->recordActions([
                EditAction::make(),
            ])
            ->toolbarActions([
                BulkActionGroup::make([
                    DeleteBulkAction::make(),
                ]),
            ]);
    }

}
