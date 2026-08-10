<?php

namespace App\Filament\Resources\DailyPipelineRuns\Pages;

use App\Filament\Resources\DailyPipelineRuns\DailyPipelineRunResource;
use App\Models\ProjectSetting;
use App\Models\Region;
use App\Models\Site;
use App\Services\DailyPipelineService;
use Filament\Actions\Action;
use Filament\Forms\Components\DateTimePicker;
use Filament\Forms\Components\Radio;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
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
            Action::make('create_from_sites')
                ->label('Создать автопайплайн')
                ->icon('heroicon-o-queue-list')
                ->color('primary')
                ->modalHeading('Создать автопайплайн по списку сайтов')
                ->modalDescription('Без Яндекса и без выбора региона: сайты уже имеют регион. Можно смешивать регионы. Запуск сейчас или по расписанию.')
                ->modalSubmitActionLabel('Создать')
                ->modalWidth('2xl')
                ->form([
                    Radio::make('sites_source')
                        ->label('Откуда сайты')
                        ->options([
                            'existing' => 'Выбрать из уже имеющихся',
                            'paste' => 'Вставить список доменов',
                            'both' => 'И выбрать, и вставить',
                        ])
                        ->default('existing')
                        ->live()
                        ->required(),
                    Select::make('site_ids')
                        ->label('Сайты')
                        ->multiple()
                        ->searchable()
                        ->getSearchResultsUsing(function (string $search): array {
                            $q = Site::query()->with('region')->orderByDesc('id')->limit(50);
                            $search = trim($search);
                            if ($search !== '') {
                                $q->where(function ($query) use ($search): void {
                                    $query->where('name', 'like', "%{$search}%")
                                        ->orWhere('url', 'like', "%{$search}%")
                                        ->orWhere('id', $search);
                                });
                            }

                            return $q->get()
                                ->mapWithKeys(fn (Site $site): array => [
                                    $site->id => '#'.$site->id.' '.$site->name
                                        .($site->region ? ' ['.$site->region->name.']' : '')
                                        .' — '.$site->url,
                                ])
                                ->all();
                        })
                        ->getOptionLabelsUsing(function (array $values): array {
                            return Site::query()
                                ->with('region')
                                ->whereIn('id', $values)
                                ->get()
                                ->mapWithKeys(fn (Site $site): array => [
                                    $site->id => '#'.$site->id.' '.$site->name
                                        .($site->region ? ' ['.$site->region->name.']' : '')
                                        .' — '.$site->url,
                                ])
                                ->all();
                        })
                        ->visible(fn (callable $get): bool => in_array($get('sites_source'), ['existing', 'both'], true))
                        ->helperText('Любые регионы. Начните вводить название или домен.'),
                    Textarea::make('domains_text')
                        ->label('Список доменов')
                        ->rows(8)
                        ->placeholder("taksihub.ru\nvisokiy-spros.ru")
                        ->helperText('По одному домену на строку. Уже известные домены подхватятся; новые — только с регионом ниже.')
                        ->visible(fn (callable $get): bool => in_array($get('sites_source'), ['paste', 'both'], true)),
                    Select::make('region_id')
                        ->label('Регион для новых доменов')
                        ->options(fn (): array => Region::query()->orderBy('name')->pluck('name', 'id')->all())
                        ->searchable()
                        ->preload()
                        ->visible(fn (callable $get): bool => in_array($get('sites_source'), ['paste', 'both'], true))
                        ->helperText('Нужен только если в списке есть домены, которых ещё нет в базе.'),
                    Radio::make('mode')
                        ->label('Режим')
                        ->options([
                            'scan_only' => 'Только сканировать формы',
                            'submit_only' => 'Только отправить формы',
                            'scan_and_submit' => 'Сканировать и отправить формы',
                        ])
                        ->default('scan_and_submit')
                        ->required(),
                    Radio::make('when')
                        ->label('Когда запустить')
                        ->options([
                            'now' => 'Сейчас',
                            'schedule' => 'По расписанию',
                        ])
                        ->default('now')
                        ->live()
                        ->required(),
                    DateTimePicker::make('scheduled_start_at')
                        ->label('Старт')
                        ->seconds(false)
                        ->native(false)
                        ->required(fn (callable $get): bool => $get('when') === 'schedule')
                        ->visible(fn (callable $get): bool => $get('when') === 'schedule'),
                    DateTimePicker::make('deadline_at')
                        ->label('Стоп (дедлайн)')
                        ->seconds(false)
                        ->native(false)
                        ->required(fn (callable $get): bool => $get('when') === 'schedule')
                        ->visible(fn (callable $get): bool => $get('when') === 'schedule')
                        ->helperText(fn (callable $get): ?string => $get('when') === 'now'
                            ? null
                            : 'После этого времени пайплайн остановится сам.'),
                    DateTimePicker::make('deadline_at_optional')
                        ->label('Стоп (необязательно)')
                        ->seconds(false)
                        ->native(false)
                        ->visible(fn (callable $get): bool => $get('when') === 'now')
                        ->helperText('Пусто = работать до ручной остановки.'),
                ])
                ->action(function (array $data): void {
                    try {
                        $source = (string) ($data['sites_source'] ?? 'existing');
                        $siteIds = in_array($source, ['existing', 'both'], true)
                            ? (array) ($data['site_ids'] ?? [])
                            : [];
                        $domainsText = in_array($source, ['paste', 'both'], true)
                            ? (string) ($data['domains_text'] ?? '')
                            : '';

                        if ($siteIds === [] && trim($domainsText) === '') {
                            Notification::make()
                                ->title('Нет сайтов')
                                ->body('Выберите сайты или вставьте список доменов.')
                                ->warning()
                                ->send();

                            return;
                        }

                        $when = (string) ($data['when'] ?? 'now');
                        $scheduledStart = $when === 'schedule' ? ($data['scheduled_start_at'] ?? null) : null;
                        $deadline = $when === 'schedule'
                            ? ($data['deadline_at'] ?? null)
                            : ($data['deadline_at_optional'] ?? null);

                        $run = app(DailyPipelineService::class)->createFromSites([
                            'region_id' => ! empty($data['region_id']) ? (int) $data['region_id'] : null,
                            'mode' => (string) ($data['mode'] ?? 'scan_and_submit'),
                            'site_ids' => $siteIds,
                            'domains_text' => $domainsText,
                            'scheduled_start_at' => $scheduledStart,
                            'deadline_at' => $deadline,
                        ]);

                        $sitesCount = is_array($run->site_ids) ? count($run->site_ids) : 0;
                        Notification::make()
                            ->title($run->status === 'pending'
                                ? "Автопайплайн #{$run->id} запланирован"
                                : "Автопайплайн #{$run->id} создан")
                            ->body($run->stageLabel().' · сайтов: '.$sitesCount)
                            ->success()
                            ->send();
                    } catch (Throwable $e) {
                        Notification::make()
                            ->title('Не удалось создать')
                            ->body($e->getMessage())
                            ->danger()
                            ->send();
                    }
                }),

            Action::make('create_pipeline')
                ->label('Яндекс сейчас')
                ->icon('heroicon-o-play')
                ->color('success')
                ->modalHeading('Запустить автопайплайн (Яндекс)')
                ->modalDescription('1) Скан Яндекса → 2) Скан форм → 3) Отправка. До ручной остановки (если не задан дедлайн).')
                ->modalSubmitActionLabel('Запустить')
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
                        ->helperText('Регион для поиска в Яндексе.'),
                    TextInput::make('query')
                        ->label('Поисковый запрос')
                        ->default(fn () => $defaults->pipeline_query_template ?: 'Купить авто в {регион}')
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
                            ->body($run->stageLabel().' · '.$run->query)
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
                ->modalDescription('Включая паузу без прокси и запланированные. Авто-возобновление после ручного стопа не сработает.')
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
