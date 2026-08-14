<?php

namespace App\Filament\Resources\Sites\RelationManagers;

use App\Filament\Resources\FormMappings\FormMappingResource;
use App\Models\FormMapping;
use App\Models\Site;
use App\Support\ScanFormLauncher;
use App\Support\TestFormSubmitEnqueuer;
use Filament\Actions\Action;
use Filament\Actions\EditAction;
use Filament\Notifications\Notification;
use Filament\Resources\RelationManagers\RelationManager;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

class FormMappingsRelationManager extends RelationManager
{
    protected static string $relationship = 'formMappings';

    protected static ?string $title = 'Маппинги форм';

    public function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('source_url')
                    ->label('Страница')
                    ->limit(40)
                    ->tooltip(fn (?string $state): ?string => $state)
                    ->placeholder('—')
                    ->wrap(),
                TextColumn::make('phone_selector')
                    ->label('Телефон селектор')
                    ->formatStateUsing(function (?string $state): string {
                        if ($state === null || $state === '') {
                            return '—';
                        }

                        return mb_strlen($state) > 20 ? mb_substr($state, 0, 20).'…' : $state;
                    })
                    ->tooltip(fn (?string $state): ?string => $state)
                    ->placeholder('—'),
                TextColumn::make('mapping_type')
                    ->label('Тип')
                    ->badge()
                    ->formatStateUsing(fn (?string $state): string => match ($state) {
                        'auto' => 'Авто',
                        'manual' => 'Ручной',
                        'sibling' => 'С поддомена',
                        default => $state ?? '—',
                    }),
                TextColumn::make('confidence')
                    ->label('Уверенность')
                    ->numeric(decimalPlaces: 2)
                    ->placeholder('—'),
            ])
            ->defaultSort('id', 'desc')
            ->emptyStateHeading('Маппингов пока нет')
            ->emptyStateDescription('Нажмите «Найти форму», чтобы бот автоматически просканировал сайт.')
            ->emptyStateIcon('heroicon-o-magnifying-glass')
            ->emptyStateActions([
                $this->scanFormAction(),
            ])
            ->headerActions([])
            ->recordActions([
                EditAction::make()
                    ->label('Изменить')
                    ->url(fn (FormMapping $record): string => FormMappingResource::getUrl('edit', ['record' => $record])),
                Action::make('test_submit')
                    ->label('Проверить форму')
                    ->icon('heroicon-o-paper-airplane')
                    ->color('success')
                    ->modalHeading('Проверить отправку по этому маппингу')
                    ->modalDescription('Будет использован именно выбранный маппинг. Имя и телефон подставятся автоматически.')
                    ->modalSubmitActionLabel('Проверить')
                    ->requiresConfirmation()
                    ->action(function (FormMapping $record): void {
                        /** @var Site $site */
                        $site = $this->getOwnerRecord();

                        $result = TestFormSubmitEnqueuer::enqueue($site, $record);

                        if (! $result['ok']) {
                            Notification::make()
                                ->title($result['title'])
                                ->body($result['body'])
                                ->warning()
                                ->send();

                            return;
                        }

                        $identity = $result['identity'];
                        $operator = ! empty($identity['operator']) ? ", {$identity['operator']}" : '';
                        $region = $identity['region'] ?? '—';

                        Notification::make()
                            ->title("Тестовая отправка поставлена в очередь (#{$result['task_id']})")
                            ->body("Маппинг #{$record->id}. {$identity['gender']}: {$identity['name']}, тел. {$identity['phone']} ({$region}{$operator})")
                            ->success()
                            ->send();
                    }),
            ])
            ->toolbarActions([]);
    }

    private function scanFormAction(): Action
    {
        return Action::make('scan_form')
            ->label('Найти форму')
            ->icon('heroicon-o-magnifying-glass')
            ->color('primary')
            ->requiresConfirmation()
            ->modalHeading('Найти форму автоматически')
            ->modalDescription('Бот откроет сайт и попытается найти форму. Если у соседнего поддомена уже есть успешный маппинг — он будет скопирован без скана.')
            ->modalSubmitActionLabel('Найти')
            ->action(function (): void {
                /** @var Site $site */
                $site = $this->getOwnerRecord();

                $result = ScanFormLauncher::reuseOrEnqueue($site);

                if ($result['mode'] === 'reused') {
                    $info = $result['result'];
                    Notification::make()
                        ->title('Маппинг взят с поддомена')
                        ->body("Донор #{$info['donor_id']} ({$info['donor_name']}), домен {$info['parent_domain']}, форм: {$info['mappings_count']}.")
                        ->success()
                        ->send();

                    return;
                }

                if ($result['mode'] === 'error') {
                    Notification::make()
                        ->title($result['title'])
                        ->body($result['body'])
                        ->danger()
                        ->send();

                    return;
                }

                Notification::make()
                    ->title("Задача поиска формы #{$result['task_id']} в очереди")
                    ->body('Обновите страницу через минуту — маппинги появятся после скана.')
                    ->success()
                    ->send();
            });
    }
}
