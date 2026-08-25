<?php

namespace App\Support;

use App\Models\DailyPipelineRun;
use App\Models\ProjectSetting;
use App\Models\Proxy;
use App\Services\DataSyncService;
use Filament\Actions\BulkAction;
use Filament\Forms\Components\TextInput;
use Filament\Notifications\Notification;
use Illuminate\Database\Eloquent\Collection;
use Throwable;

final class DataSyncFilamentActions
{
    public static function pushSelectedSitesBulkAction(): BulkAction
    {
        return BulkAction::make('sync_push_sites')
            ->label('Отправить на сервер')
            ->icon('heroicon-o-cloud-arrow-up')
            ->color('primary')
            ->modalHeading('Отправить выбранные сайты на удалённый сервер?')
            ->modalDescription('Уйдут сайты вместе с маппингами форм. Токен — локальный BOT_API_TOKEN (тот же, что на сервере).')
            ->modalSubmitActionLabel('Отправить')
            ->deselectRecordsAfterCompletion()
            ->form(self::remoteUrlFormSchema())
            ->action(function (Collection $records, array $data): void {
                try {
                    $ids = $records->modelKeys();
                    $sync = app(DataSyncService::class);
                    $payload = $sync->exportSites($ids);
                    $payload['replace_mappings'] = true;
                    $result = $sync->pushToRemoteUrl((string) ($data['remote_url'] ?? ''), 'sites', $payload);

                    Notification::make()
                        ->title('Сайты отправлены ('.count($ids).')')
                        ->body(self::resultSummary($result))
                        ->success()
                        ->send();
                } catch (Throwable $e) {
                    Notification::make()->title('Не удалось отправить')->body($e->getMessage())->danger()->send();
                }
            });
    }

    public static function pushSelectedProxiesBulkAction(): BulkAction
    {
        return BulkAction::make('sync_push_proxies')
            ->label('Отправить на сервер')
            ->icon('heroicon-o-cloud-arrow-up')
            ->color('primary')
            ->modalHeading('Отправить выбранные прокси на удалённый сервер?')
            ->modalDescription('Токен — локальный BOT_API_TOKEN.')
            ->modalSubmitActionLabel('Отправить')
            ->deselectRecordsAfterCompletion()
            ->form(self::remoteUrlFormSchema())
            ->action(function (Collection $records, array $data): void {
                try {
                    $ids = $records->modelKeys();
                    $sync = app(DataSyncService::class);
                    $all = $sync->exportProxies();
                    $selected = Proxy::query()->whereIn('id', $ids)->get(['host', 'port']);
                    $keys = $selected->map(fn (Proxy $p): string => strtolower($p->host).':'.$p->port)->all();

                    $all['proxies'] = array_values(array_filter(
                        $all['proxies'],
                        static function (array $row) use ($keys): bool {
                            $key = strtolower((string) ($row['host'] ?? '')).':'.(int) ($row['port'] ?? 0);

                            return in_array($key, $keys, true);
                        },
                    ));

                    if ($all['proxies'] === []) {
                        Notification::make()->title('Нечего отправлять')->warning()->send();

                        return;
                    }

                    $result = $sync->pushToRemoteUrl((string) ($data['remote_url'] ?? ''), 'proxies', $all);
                    Notification::make()
                        ->title('Прокси отправлены ('.count($all['proxies']).')')
                        ->body(self::resultSummary($result))
                        ->success()
                        ->send();
                } catch (Throwable $e) {
                    Notification::make()->title('Не удалось отправить')->body($e->getMessage())->danger()->send();
                }
            });
    }

    public static function pushSelectedRegionsBulkAction(): BulkAction
    {
        return BulkAction::make('sync_push_regions')
            ->label('Отправить на сервер')
            ->icon('heroicon-o-cloud-arrow-up')
            ->color('primary')
            ->modalHeading('Отправить выбранные регионы на удалённый сервер?')
            ->modalDescription('Уйдут регионы вместе с сеткой телефонов (диапазоны). Сопоставление на сервере — по названию региона.')
            ->modalSubmitActionLabel('Отправить')
            ->deselectRecordsAfterCompletion()
            ->form(self::remoteUrlFormSchema())
            ->action(function (Collection $records, array $data): void {
                try {
                    $ids = $records->modelKeys();
                    $sync = app(DataSyncService::class);
                    $payload = $sync->exportRegions($ids);
                    $payload['replace_prefixes'] = true;

                    if (($payload['regions'] ?? []) === []) {
                        Notification::make()->title('Нечего отправлять')->warning()->send();

                        return;
                    }

                    $result = $sync->pushToRemoteUrl((string) ($data['remote_url'] ?? ''), 'regions', $payload);
                    Notification::make()
                        ->title('Регионы отправлены ('.count($payload['regions']).')')
                        ->body(self::resultSummary($result))
                        ->success()
                        ->send();
                } catch (Throwable $e) {
                    Notification::make()->title('Не удалось отправить')->body($e->getMessage())->danger()->send();
                }
            });
    }

    public static function pushSelectedPipelinesBulkAction(): BulkAction
    {
        return BulkAction::make('sync_push_pipelines')
            ->label('Экспорт API')
            ->icon('heroicon-o-cloud-arrow-up')
            ->color('primary')
            ->modalHeading('Отправить выбранные автопайплайны на сервер?')
            ->modalDescription('Каждый прогон уйдёт вместе с сайтами и маппингами. Укажите URL целевого сервера вручную.')
            ->modalSubmitActionLabel('Отправить')
            ->deselectRecordsAfterCompletion()
            ->form(self::remoteUrlFormSchema())
            ->action(function (Collection $records, array $data): void {
                try {
                    $sync = app(DataSyncService::class);
                    $remoteUrl = (string) ($data['remote_url'] ?? '');
                    $sent = 0;
                    $errors = [];

                    foreach ($records as $record) {
                        if (! $record instanceof DailyPipelineRun) {
                            continue;
                        }
                        try {
                            $payload = $sync->exportPipeline($record);
                            $payload['replace_mappings'] = true;
                            $sync->pushToRemoteUrl($remoteUrl, 'daily-pipeline-runs', $payload);
                            $sent++;
                        } catch (Throwable $e) {
                            $errors[] = '#'.$record->id.': '.$e->getMessage();
                        }
                    }

                    if ($sent > 0 && $errors === []) {
                        Notification::make()
                            ->title("Отправлено пайплайнов: {$sent}")
                            ->success()
                            ->send();
                    } elseif ($sent > 0) {
                        Notification::make()
                            ->title("Отправлено: {$sent}, с ошибками: ".count($errors))
                            ->body(implode("\n", array_slice($errors, 0, 5)))
                            ->warning()
                            ->send();
                    } else {
                        Notification::make()
                            ->title('Не удалось отправить')
                            ->body(implode("\n", array_slice($errors, 0, 5)) ?: 'Нет записей')
                            ->danger()
                            ->send();
                    }
                } catch (Throwable $e) {
                    Notification::make()->title('Не удалось отправить')->body($e->getMessage())->danger()->send();
                }
            });
    }

    /**
     * @return array<int, TextInput>
     */
    private static function remoteUrlFormSchema(): array
    {
        return [
            TextInput::make('remote_url')
                ->label('URL удалённого сервера')
                ->placeholder('https://meterorix.com')
                ->helperText('Базовый URL без /api/… (например https://example.com). Можно указать другой сервер для разных наборов сайтов.')
                ->url()
                ->required()
                ->default(fn (): ?string => self::defaultRemoteUrl()),
        ];
    }

    private static function defaultRemoteUrl(): ?string
    {
        $url = trim((string) (ProjectSetting::query()->value('sync_remote_url') ?? ''));

        return $url !== '' ? $url : null;
    }

    /**
     * @param  array<string, mixed>  $result
     */
    private static function resultSummary(array $result): string
    {
        $parts = [];
        foreach (['created_sites', 'updated_sites', 'created_mappings', 'created', 'updated', 'synced_prefixes', 'created_pipelines'] as $key) {
            if (isset($result[$key])) {
                $parts[] = "{$key}={$result[$key]}";
            }
        }
        if (isset($result['errors']) && is_array($result['errors']) && $result['errors'] !== []) {
            $parts[] = 'errors='.count($result['errors']);
        }

        return $parts !== [] ? implode(', ', $parts) : 'ok';
    }
}
