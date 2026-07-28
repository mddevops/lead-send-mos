<?php

namespace App\Filament\Resources\DailyPipelineRuns\Pages;

use App\Filament\Resources\DailyPipelineRuns\DailyPipelineRunResource;
use App\Models\ProjectSetting;
use App\Models\Region;
use App\Services\DailyPipelineService;
use Filament\Actions\Action;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Notifications\Notification;
use Filament\Resources\Pages\ListRecords;
use Throwable;

class ListDailyPipelineRuns extends ListRecords
{
    protected static string $resource = DailyPipelineRunResource::class;

    protected function getHeaderActions(): array
    {
        $defaults = ProjectSetting::query()->firstOrCreate([]);

        return [
            Action::make('create_pipeline')
                ->label('Запустить сейчас')
                ->icon('heroicon-o-play')
                ->color('success')
                ->modalHeading('Запустить автопайплайн')
                ->modalDescription('Сразу: 1) Скан Яндекса → 2) Скан форм → 3) Отправка по кругу. Работает, пока не нажмёте «Остановить». Proxy обязателен.')
                ->modalSubmitActionLabel('Запустить сейчас')
                ->form([
                    Select::make('region_id')
                        ->label('Регион')
                        ->options(fn (): array => Region::query()->orderBy('name')->pluck('name', 'id')->all())
                        ->searchable()
                        ->preload()
                        ->live()
                        ->default(fn () => $defaults->pipeline_region_id)
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
                        ->required()
                        ->helperText('Регион строго определяет поисковый запрос и сайты прогона.'),
                    TextInput::make('query')
                        ->label('Поисковый запрос')
                        ->default(fn () => $defaults->pipeline_query_template ?: 'Купить авто в {регион}')
                        ->helperText('Плейсхолдер {регион} подставится названием выбранного региона.')
                        ->required()
                        ->maxLength(255),
                    TextInput::make('max_pages')
                        ->label('Страниц выдачи')
                        ->numeric()
                        ->minValue(1)
                        ->maxValue(5)
                        ->default(fn () => (int) ($defaults->pipeline_max_pages ?? 3))
                        ->required(),
                ])
                ->action(function (array $data): void {
                    try {
                        $run = app(DailyPipelineService::class)->create($data);
                        Notification::make()
                            ->title("Автопайплайн #{$run->id} запущен")
                            ->body($run->stageLabel().' · работает до ручной остановки · '.$run->query)
                            ->success()
                            ->send();
                    } catch (Throwable $e) {
                        Notification::make()
                            ->title('Не удалось запустить')
                            ->body($e->getMessage())
                            ->danger()
                            ->send();
                    }
                }),

            Action::make('stop_all')
                ->label('Остановить все')
                ->icon('heroicon-o-stop')
                ->color('danger')
                ->requiresConfirmation()
                ->modalHeading('Остановить все активные автопайплайны?')
                ->modalDescription('Очередь задач будет очищена, текущие в работе завершат текущий шаг.')
                ->action(function (): void {
                    $n = app(DailyPipelineService::class)->stopAllActive();
                    Notification::make()
                        ->title($n > 0 ? "Остановлено: {$n}" : 'Активных прогонов нет')
                        ->{$n > 0 ? 'success' : 'warning'}()
                        ->send();
                }),
        ];
    }
}
