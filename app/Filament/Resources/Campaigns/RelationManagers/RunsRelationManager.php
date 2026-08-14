<?php

namespace App\Filament\Resources\Campaigns\RelationManagers;

use Filament\Actions\Action;
use Filament\Actions\BulkActionGroup;
use Filament\Actions\DeleteBulkAction;
use Filament\Forms\Components\DatePicker;
use Filament\Forms\Components\TextInput;
use Filament\Resources\RelationManagers\RelationManager;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\Filter;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;

class RunsRelationManager extends RelationManager
{
    protected static string $relationship = 'runs';

    protected static ?string $title = 'Результаты по сайтам';

    public function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('site.url')
                    ->label('Сайт')
                    ->searchable()
                    ->limit(40)
                    ->tooltip(fn (?string $state): ?string => $state),
                TextColumn::make('phone')
                    ->label('Телефон')
                    ->getStateUsing(function ($record): string {
                        $fromRun = trim((string) ($record->phone ?? ''));
                        if ($fromRun !== '') {
                            return $fromRun;
                        }

                        return trim((string) ($record->campaign?->phone ?? '')) ?: '—';
                    })
                    ->searchable(),
                TextColumn::make('proxy.name')
                    ->label('Прокси')
                    ->searchable(),
                TextColumn::make('status')
                    ->label('Статус')
                    ->badge(),
                TextColumn::make('duration_ms')
                    ->label('Время (мс)')
                    ->numeric()
                    ->sortable(),
                TextColumn::make('response_url')
                    ->label('URL ответа')
                    ->limit(30),
                TextColumn::make('response_text')
                    ->label('Текст ответа')
                    ->limit(60)
                    ->tooltip(fn (?string $state): ?string => $state),
                TextColumn::make('error_message')
                    ->label('Ошибка')
                    ->limit(50)
                    ->tooltip(fn (?string $state): ?string => $state),
                TextColumn::make('screenshot_before')
                    ->label('Скриншот до')
                    ->formatStateUsing(fn (?string $state): string => filled($state) ? 'Открыть' : '-')
                    ->url(fn (?string $state): ?string => $this->resolveScreenshotUrl($state))
                    ->openUrlInNewTab(),
                TextColumn::make('screenshot_after')
                    ->label('Скриншот после')
                    ->formatStateUsing(fn (?string $state): string => filled($state) ? 'Открыть' : '-')
                    ->url(fn (?string $state): ?string => $this->resolveScreenshotUrl($state))
                    ->openUrlInNewTab(),
                TextColumn::make('created_at')
                    ->label('Создано')
                    ->dateTime()
                    ->sortable(),
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
            ->headerActions([])
            ->recordActions([
                Action::make('open_before')
                    ->label('Скриншот до')
                    ->icon('heroicon-o-photo')
                    ->visible(fn ($record): bool => filled($record->screenshot_before))
                    ->action(fn ($record) => redirect($this->resolveScreenshotUrl($record->screenshot_before))),
                Action::make('open_after')
                    ->label('Скриншот после')
                    ->icon('heroicon-o-photo')
                    ->visible(fn ($record): bool => filled($record->screenshot_after))
                    ->action(fn ($record) => redirect($this->resolveScreenshotUrl($record->screenshot_after))),
            ])
            ->toolbarActions([
                BulkActionGroup::make([
                    DeleteBulkAction::make(),
                ]),
            ]);
    }

    private function resolveScreenshotUrl(?string $path): ?string
    {
        if (blank($path)) {
            return null;
        }

        if (str_starts_with($path, 'http://') || str_starts_with($path, 'https://')) {
            return $path;
        }

        return asset('storage/'.ltrim($path, '/'));
    }
}
