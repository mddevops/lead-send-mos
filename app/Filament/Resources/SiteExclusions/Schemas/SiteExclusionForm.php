<?php

namespace App\Filament\Resources\SiteExclusions\Schemas;

use App\Models\SiteExclusion;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\Toggle;
use Filament\Schemas\Schema;

class SiteExclusionForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema->components([
            TextInput::make('domain')
                ->label('Домен')
                ->required()
                ->placeholder('avito.ru')
                ->helperText('Без https:// и www. Поддомены тоже исключаются.')
                ->dehydrateStateUsing(fn (?string $state): string => SiteExclusion::normalizeDomain((string) $state))
                ->unique(ignoreRecord: true),
            Toggle::make('is_active')
                ->label('Активно')
                ->default(true),
            Textarea::make('note')
                ->label('Заметка')
                ->rows(2)
                ->columnSpanFull(),
        ]);
    }
}
