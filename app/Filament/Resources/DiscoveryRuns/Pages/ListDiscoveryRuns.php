<?php

namespace App\Filament\Resources\DiscoveryRuns\Pages;

use App\Filament\Resources\DiscoveryRuns\DiscoveryRunResource;
use App\Models\Region;
use App\Services\YandexAdsDiscoveryService;
use Filament\Actions\Action;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Notifications\Notification;
use Throwable;
use Filament\Resources\Pages\ListRecords;
use Illuminate\Database\Eloquent\Builder;

class ListDiscoveryRuns extends ListRecords
{
    protected static string $resource = DiscoveryRunResource::class;

    protected function getTableQuery(): ?Builder
    {
        return parent::getTableQuery()
            ?->withCount([
                'sites as forms_scanned_count' => fn (Builder $query): Builder => $query->where('status', '!=', 'new'),
                'sites as forms_not_scanned_count' => fn (Builder $query): Builder => $query->where('status', 'new'),
            ]);
    }

    protected function getHeaderActions(): array
    {
        return [
            Action::make('startDiscovery')
                ->label('Сканировать Яндекс Promo')
                ->icon('heroicon-o-play')
                ->color('success')
                ->modalHeading('Поиск рекламы в Яндексе')
                ->modalDescription('Бот откроет yandex.ru, выполнит поисковый запрос и соберёт сайты из блоков «Промо» на указанных страницах выдачи.')
                ->modalSubmitActionLabel('Запустить')
                ->form([
                    Select::make('region_id')
                        ->label('Регион')
                        ->options(fn (): array => Region::query()->orderBy('name')->pluck('name', 'id')->all())
                        ->searchable()
                        ->preload()
                        ->live()
                        ->afterStateUpdated(function (?int $state, callable $set, callable $get): void {
                            $region = $state ? Region::query()->find($state) : null;
                            if (! $region) {
                                return;
                            }

                            $current = trim((string) ($get('query') ?? ''));
                            if ($current === '' || str_contains($current, '{регион}') || str_contains($current, '{region}')) {
                                $set('query', 'Купить авто в '.$region->name);
                            }
                        })
                        ->required(),
                    TextInput::make('query')
                        ->label('Поисковый запрос')
                        ->default('Купить авто в {регион}')
                        ->helperText('По умолчанию: «Купить авто в {регион}». Можно изменить. Плейсхолдер {регион} подставится названием региона.')
                        ->required()
                        ->maxLength(255),
                    TextInput::make('max_pages')
                        ->label('Страниц выдачи')
                        ->helperText('Сколько страниц результатов поиска сканировать подряд (1-я без &p=, 2-я — &p=1, 3-я — &p=2 и т.д.). Всегда через proxy.')
                        ->numeric()
                        ->minValue(1)
                        ->maxValue(5)
                        ->default(3)
                        ->required(),
                ])
                ->action(function (array $data): void {
                    $region = Region::query()->findOrFail((int) $data['region_id']);

                    try {
                        $result = app(YandexAdsDiscoveryService::class)->queueRun(
                            $region,
                            (int) ($data['max_pages'] ?? 3),
                            true,
                            is_string($data['query'] ?? null) ? $data['query'] : null,
                        );
                    } catch (Throwable $e) {
                        Notification::make()
                            ->title('Не удалось запустить скан')
                            ->body($e->getMessage())
                            ->danger()
                            ->send();

                        return;
                    }

                    Notification::make()
                        ->title('Скан поставлен в очередь')
                        ->body("Прогон #{$result['run']->id}, задача #{$result['task']->id}. Запрос: {$result['run']->query}")
                        ->success()
                        ->send();
                }),
        ];
    }
}
