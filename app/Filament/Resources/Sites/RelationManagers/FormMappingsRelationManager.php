<?php

namespace App\Filament\Resources\Sites\RelationManagers;

use App\Filament\Resources\FormMappings\FormMappingResource;
use App\Models\FormMapping;
use App\Models\Site;
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
}
