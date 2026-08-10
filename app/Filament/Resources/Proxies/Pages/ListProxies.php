<?php

namespace App\Filament\Resources\Proxies\Pages;

use App\Filament\Resources\Proxies\ProxyResource;
use App\Models\Proxy;
use App\Services\ProxyBulkImporter;
use App\Services\ProxyHealthChecker;
use Filament\Actions\Action;
use Filament\Actions\ActionGroup;
use Filament\Actions\CreateAction;
use Filament\Forms\Components\Textarea;
use Filament\Notifications\Notification;
use Filament\Resources\Pages\ListRecords;

class ListProxies extends ListRecords
{
    protected static string $resource = ProxyResource::class;

    protected function getHeaderActions(): array
    {
        return [
            Action::make('checkProxies')
                ->label('Проверить прокси')
                ->icon('heroicon-o-signal')
                ->color('warning')
                ->requiresConfirmation()
                ->modalHeading('Проверить прокси')
                ->modalDescription('Проверяется выход в интернет через каждый прокси со статусом active / disabled / failed (api.ipify.org). Рабочие включаются, мёртвые отключаются.')
                ->modalSubmitActionLabel('Проверить')
                ->action(function (): void {
                    set_time_limit(0);

                    $checker = app(ProxyHealthChecker::class);
                    $proxies = $checker->proxiesForScheduledCheck();

                    if ($proxies->isEmpty()) {
                        Notification::make()
                            ->title('Нет прокси для проверки')
                            ->body('Список пуст или все прокси в cooldown.')
                            ->warning()
                            ->send();

                        return;
                    }

                    $report = $checker->checkAndDisableDead($proxies);

                    $pipelines = app(\App\Services\DailyPipelineService::class);
                    if (($report['has_active'] ?? false) || \App\Models\Proxy::query()->where('status', 'active')->exists()) {
                        $pipelines->resumePausedForProxy();
                    } else {
                        $pipelines->pauseActivePipelinesForNoProxy();
                    }

                    $lines = [
                        "Проверено: {$report['checked']}",
                        'Работают: '.count($report['working']),
                        'Не работают: '.count($report['failed']),
                        "Отключено: {$report['disabled']}",
                    ];

                    if ($report['working'] !== []) {
                        $preview = collect($report['working'])
                            ->take(8)
                            ->map(fn (array $row): string => "• {$row['name']} → {$row['ip']} ({$row['latency_ms']} мс)")
                            ->implode("\n");

                        $lines[] = "\nOK:\n".$preview;

                        if (count($report['working']) > 8) {
                            $lines[] = '... и ещё '.(count($report['working']) - 8);
                        }
                    }

                    if ($report['failed'] !== []) {
                        $preview = collect($report['failed'])
                            ->take(8)
                            ->map(fn (array $row): string => "• {$row['name']}: {$row['error']}")
                            ->implode("\n");

                        $lines[] = "\nОтключены:\n".$preview;

                        if (count($report['failed']) > 8) {
                            $lines[] = '... и ещё '.(count($report['failed']) - 8);
                        }
                    }

                    $notification = Notification::make()
                        ->title('Проверка прокси завершена')
                        ->body(implode("\n", $lines));

                    if ($report['failed'] === []) {
                        $notification->success();
                    } elseif ($report['working'] === []) {
                        $notification->danger();
                    } else {
                        $notification->warning();
                    }

                    $notification->send();

                    $this->resetTable();
                }),
            ActionGroup::make([
                CreateAction::make()
                    ->label('Один прокси'),
                Action::make('bulkImport')
                    ->label('Добавить массово')
                    ->icon('heroicon-o-queue-list')
                    ->modalHeading('Массовое добавление прокси')
                    ->modalDescription('По одному на строку: host:port:login:password. Тип — мобильный. После сохранения каждый проверяется: рабочий → Активен, нет → Отключён.')
                    ->modalSubmitActionLabel('Добавить и проверить')
                    ->form([
                        Textarea::make('lines')
                            ->label('Список прокси')
                            ->rows(12)
                            ->required()
                            ->placeholder("194.61.77.242:64644:9HrHem8L4:cqEEHpXWc\n194.156.0.166:62766:EPZEZPyCD:vLfXtKZLD")
                            ->helperText('Формат: IP:PORT:USER:PASS'),
                    ])
                    ->action(function (array $data): void {
                        set_time_limit(0);

                        $report = app(ProxyBulkImporter::class)->importFromText((string) ($data['lines'] ?? ''));

                        $lines = [
                            "Создано: {$report['created']}",
                            "Обновлено: {$report['updated']}",
                            "Активны: {$report['active']}",
                            "Отключены: {$report['disabled']}",
                            "Пропущено: {$report['skipped']}",
                        ];

                        if ($report['details'] !== []) {
                            $preview = collect($report['details'])
                                ->take(10)
                                ->map(function (array $row): string {
                                    if ($row['status'] === 'active') {
                                        return "• {$row['host']}:{$row['port']} → {$row['ip']}";
                                    }

                                    return "• {$row['host']}:{$row['port']} ✕ ".($row['error'] ?? 'нет ответа');
                                })
                                ->implode("\n");
                            $lines[] = "\n".$preview;
                        }

                        if ($report['errors'] !== []) {
                            $lines[] = "\nОшибки:\n".implode("\n", array_slice($report['errors'], 0, 8));
                        }

                        $notification = Notification::make()
                            ->title('Массовый импорт завершён')
                            ->body(implode("\n", $lines));

                        if ($report['active'] > 0 && $report['disabled'] === 0 && $report['skipped'] === 0) {
                            $notification->success();
                        } elseif ($report['active'] === 0) {
                            $notification->danger();
                        } else {
                            $notification->warning();
                        }

                        $notification->send();
                        $this->resetTable();
                    }),
            ])
                ->label('Добавить')
                ->icon('heroicon-o-plus')
                ->button()
                ->color('primary'),
        ];
    }
}
