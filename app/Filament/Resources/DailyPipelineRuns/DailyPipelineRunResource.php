<?php

namespace App\Filament\Resources\DailyPipelineRuns;

use App\Filament\Resources\DailyPipelineRuns\Pages\ListDailyPipelineRuns;
use App\Filament\Resources\DailyPipelineRuns\Pages\ViewDailyPipelineRun;
use App\Filament\Resources\DailyPipelineRuns\Tables\DailyPipelineRunsTable;
use App\Models\DailyPipelineRun;
use BackedEnum;
use Filament\Infolists\Components\TextEntry;
use Filament\Resources\Resource;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use UnitEnum;

class DailyPipelineRunResource extends Resource
{
    protected static ?string $model = DailyPipelineRun::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedClock;

    protected static ?string $navigationLabel = 'Автопайплайн';

    protected static string|UnitEnum|null $navigationGroup = 'Поиск';

    protected static ?string $modelLabel = 'Прогон автопайплайна';

    protected static ?string $pluralModelLabel = 'Автопайплайн';

    protected static ?int $navigationSort = 5;

    public static function table(Table $table): Table
    {
        return DailyPipelineRunsTable::configure($table);
    }

    public static function infolist(Schema $schema): Schema
    {
        return $schema->components([
            Section::make('Прогон')
                ->columns(3)
                ->schema([
                    TextEntry::make('id')->label('ID'),
                    TextEntry::make('stage')
                        ->label('Этап')
                        ->state(fn (DailyPipelineRun $record): string => $record->stageLabel())
                        ->badge(),
                    TextEntry::make('status')
                        ->label('Статус')
                        ->formatStateUsing(fn (DailyPipelineRun $record): string => $record->statusLabel())
                        ->badge(),
                    TextEntry::make('run_date')->label('Дата')->date(),
                    TextEntry::make('region.name')->label('Регион'),
                    TextEntry::make('sites_count')
                        ->label('Сайтов')
                        ->state(fn (DailyPipelineRun $record): int => $record->sitesCount()),
                    TextEntry::make('query')->label('Запрос')->columnSpanFull(),
                    TextEntry::make('max_pages')->label('Страниц выдачи'),
                    TextEntry::make('use_proxy')->label('Proxy')->badge(),
                    TextEntry::make('start_time')->label('Старт (план время)'),
                    TextEntry::make('scheduled_start_at')->label('Старт (дата/время)')->dateTime('d.m.Y H:i')->placeholder('сразу'),
                    TextEntry::make('deadline_at')
                        ->label('Дедлайн')
                        ->dateTime('d.m.Y H:i')
                        ->placeholder('до ручной остановки'),
                    TextEntry::make('timezone')->label('Часовой пояс'),
                    TextEntry::make('pause_reason')->label('Причина паузы')->placeholder('—'),
                    TextEntry::make('submit_lap')
                        ->label('Круг отправки')
                        ->state(fn (DailyPipelineRun $record): string => (string) max(0, (int) $record->submit_cycle_current)
                            .($record->deadline_at ? ' (до дедлайна)' : ' (до остановки)')),
                    TextEntry::make('error_message')->label('Ошибка')->columnSpanFull()->placeholder('—'),
                ]),
            Section::make('Статистика по этапам')
                ->columns(4)
                ->schema([
                    TextEntry::make('promo_sites_count')->label('1) Промо сайтов'),
                    TextEntry::make('new_sites_count')->label('Сайтов в прогоне'),
                    TextEntry::make('scan_queued_count')->label('2) Скан форм (очередь)'),
                    TextEntry::make('forms_found_count')->label('2) Форм найдено'),
                    TextEntry::make('forms_not_found_count')->label('2) Без формы / ошибка'),
                    TextEntry::make('submit_queued_count')->label('3) Отправок всего'),
                    TextEntry::make('submit_success_count')->label('3) Успешно'),
                    TextEntry::make('submit_failed_count')->label('3) Ошибки'),
                    TextEntry::make('submit_unknown_count')->label('3) Неизвестно'),
                ]),
            Section::make('Отчёт: формы не найдены')
                ->schema([
                    TextEntry::make('forms_missing_report')
                        ->label('')
                        ->state(function (DailyPipelineRun $record): string {
                            $rows = $record->report['forms_missing'] ?? [];
                            if ($rows === []) {
                                return '—';
                            }
                            $lines = [];
                            foreach ($rows as $row) {
                                $lines[] = '#'.($row['site_id'] ?? '?').' '.($row['url'] ?? '').' — '.($row['note'] ?? ($row['status'] ?? ''));
                            }

                            return implode("\n", $lines);
                        })
                        ->markdown()
                        ->columnSpanFull(),
                ])
                ->collapsed()
                ->visible(fn (DailyPipelineRun $record): bool => ! empty($record->report['forms_missing'] ?? [])),
            Section::make('Время')
                ->columns(3)
                ->schema([
                    TextEntry::make('started_at')->label('Старт')->dateTime(),
                    TextEntry::make('deadline_at')->label('Дедлайн')->dateTime(),
                    TextEntry::make('finished_at')->label('Финиш')->dateTime(),
                    TextEntry::make('discovery_finished_at')->label('1) Поиск готов')->dateTime(),
                    TextEntry::make('scan_finished_at')->label('2) Скан готов')->dateTime(),
                    TextEntry::make('submit_finished_at')->label('3) Отправка готова')->dateTime(),
                ]),
        ]);
    }

    public static function getPages(): array
    {
        return [
            'index' => ListDailyPipelineRuns::route('/'),
            'view' => ViewDailyPipelineRun::route('/{record}'),
        ];
    }

    public static function canCreate(): bool
    {
        return false;
    }
}
