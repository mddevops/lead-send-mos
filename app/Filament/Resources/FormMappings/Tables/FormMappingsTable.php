<?php

namespace App\Filament\Resources\FormMappings\Tables;

use Filament\Actions\BulkActionGroup;
use Filament\Actions\DeleteBulkAction;
use Filament\Actions\EditAction;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

class FormMappingsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('site.name')
                    ->label('Сайт')
                    ->searchable(),
                TextColumn::make('source_url')
                    ->label('Страница')
                    ->searchable()
                    ->wrap()
                    ->toggleable(),
                TextColumn::make('name_selector')
                    ->label('Имя селектор')
                    ->searchable(),
                TextColumn::make('phone_selector')
                    ->label('Телефон селектор')
                    ->searchable(),
                TextColumn::make('email_selector')
                    ->label('Email селектор')
                    ->searchable(),
                TextColumn::make('message_selector')
                    ->label('Сообщение селектор')
                    ->searchable(),
                TextColumn::make('submit_selector')
                    ->label('Submit селектор')
                    ->searchable(),
                TextColumn::make('open_modal_selector')
                    ->label('Modal open селектор')
                    ->searchable(),
                TextColumn::make('consent_checkbox_selector')
                    ->label('Чекбокс согласия')
                    ->searchable(),
                TextColumn::make('success_selector')
                    ->label('Success селектор')
                    ->searchable(),
                TextColumn::make('error_selector')
                    ->label('Error селектор')
                    ->searchable(),
                TextColumn::make('iframe_selector')
                    ->label('Iframe селектор')
                    ->searchable(),
                TextColumn::make('wait_after_submit_ms')
                    ->label('Ожидание (мс)')
                    ->numeric()
                    ->sortable(),
                TextColumn::make('mapping_type')
                    ->label('Тип')
                    ->badge(),
                TextColumn::make('confidence')
                    ->label('Уверенность')
                    ->numeric()
                    ->sortable(),
                IconColumn::make('screenshot_enabled')
                    ->label('Скриншот')
                    ->boolean(),
                TextColumn::make('screenshot_path')
                    ->label('Путь скриншота')
                    ->searchable(),
                TextColumn::make('status')
                    ->label('Статус')
                    ->badge(),
                TextColumn::make('created_at')
                    ->label('Создано')
                    ->dateTime()
                    ->sortable()
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('updated_at')
                    ->label('Обновлено')
                    ->dateTime()
                    ->sortable()
                    ->toggleable(isToggledHiddenByDefault: true),
            ])
            ->filters([
                //
            ])
            ->recordActions([
                EditAction::make(),
            ])
            ->toolbarActions([
                BulkActionGroup::make([
                    DeleteBulkAction::make(),
                ]),
            ]);
    }
}
