<?php

namespace App\Filament\Widgets;

use App\Filament\Resources\DailyPipelineRuns\DailyPipelineRunResource;
use App\Filament\Resources\DailyPipelineRuns\Tables\DailyPipelineRunsTable;
use App\Models\DailyPipelineRun;
use Filament\Tables\Table;
use Filament\Widgets\TableWidget;
use Illuminate\Contracts\Support\Htmlable;

class DailyPipelineOverviewWidget extends TableWidget
{
    protected static ?int $sort = 1;

    protected int|string|array $columnSpan = 'full';

    public function getTableHeading(): string|Htmlable|null
    {
        return 'Автопайплайн';
    }

    public function table(Table $table): Table
    {
        return DailyPipelineRunsTable::configure($table)
            ->query(DailyPipelineRun::query()->with('region')->latest('id'))
            ->heading('Автопайплайн')
            ->description('Последние прогоны. Полный список — в разделе «Автопайплайн».')
            ->headerActions([
                \Filament\Actions\Action::make('open_pipeline')
                    ->label('Открыть Автопайплайн')
                    ->icon('heroicon-o-arrow-top-right-on-square')
                    ->url(DailyPipelineRunResource::getUrl('index'))
                    ->color('gray'),
            ])
            ->paginated([10, 25])
            ->defaultPaginationPageOption(10)
            ->poll('15s');
    }
}
