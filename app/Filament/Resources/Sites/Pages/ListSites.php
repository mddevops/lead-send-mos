<?php

namespace App\Filament\Resources\Sites\Pages;

use App\Filament\Resources\Sites\SiteResource;
use App\Models\Region;
use App\Services\YandexMapsSiteImporter;
use Filament\Actions\Action;
use Filament\Actions\CreateAction;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Notifications\Notification;
use Filament\Resources\Pages\ListRecords;

class ListSites extends ListRecords
{
    protected static string $resource = SiteResource::class;

    protected function getHeaderActions(): array
    {
        return [
            Action::make('importFromYandexMaps')
                ->label('Добавить из Яндекс Карты')
                ->icon('heroicon-o-map')
                ->color('info')
                ->modalHeading('Импорт из Яндекс Карт')
                ->modalDescription('Вставьте JSON-массив организаций из Яндекс Карт. Будут импортированы только записи с URL сайта.')
                ->modalSubmitActionLabel('Импорт')
                ->form([
                    Select::make('region_id')
                        ->label('Регион')
                        ->options(fn (): array => Region::query()->orderBy('name')->pluck('name', 'id')->all())
                        ->searchable()
                        ->preload()
                        ->required(),
                    Textarea::make('json')
                        ->label('JSON данные')
                        ->placeholder('[{"shortTitle":"АвтоЛайт","urls":["https://example.ru/"], ...}]')
                        ->rows(18)
                        ->required()
                        ->columnSpanFull(),
                ])
                ->action(function (array $data): void {
                    $importer = (new YandexMapsSiteImporter)->import(
                        $data['json'],
                        (int) $data['region_id'],
                    );

                    $body = "Создано: {$importer->created}, пропущено: {$importer->skipped}.";

                    if ($importer->errors !== []) {
                        $preview = implode("\n", array_slice($importer->errors, 0, 5));

                        if (count($importer->errors) > 5) {
                            $preview .= "\n... и ещё ".(count($importer->errors) - 5);
                        }

                        $body .= "\n\n".$preview;
                    }

                    Notification::make()
                        ->title('Импорт завершён')
                        ->body($body)
                        ->success()
                        ->send();
                }),
            CreateAction::make(),
        ];
    }
}
