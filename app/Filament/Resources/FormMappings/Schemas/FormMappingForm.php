<?php

namespace App\Filament\Resources\FormMappings\Schemas;

use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\Toggle;
use Filament\Schemas\Schema;

class FormMappingForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Select::make('site_id')
                    ->label('Сайт')
                    ->relationship('site', 'name')
                    ->searchable()
                    ->preload()
                    ->required(),
                TextInput::make('source_url')
                    ->label('Страница с формой')
                    ->url()
                    ->columnSpanFull(),
                TextInput::make('name_selector')
                    ->label('CSS селектор поля имени')
                    ->required(),
                TextInput::make('phone_selector')
                    ->label('CSS селектор поля телефона')
                    ->required(),
                TextInput::make('email_selector')
                    ->label('CSS селектор поля email')
                    ->email(),
                TextInput::make('message_selector')
                    ->label('CSS селектор поля сообщения'),
                TextInput::make('submit_selector')
                    ->label('CSS селектор кнопки submit')
                    ->required(),
                TextInput::make('open_modal_selector')
                    ->label('CSS селектор кнопки открытия формы (modal)'),
                TextInput::make('form_scope_selector')
                    ->label('CSS селектор области формы (шаг 2 ручного маппинга)'),
                TextInput::make('consent_checkbox_selector')
                    ->label('CSS селектор чекбокса согласия'),
                TextInput::make('success_selector')
                    ->label('CSS селектор успеха'),
                TextInput::make('error_selector')
                    ->label('CSS селектор ошибки'),
                TextInput::make('iframe_selector')
                    ->label('CSS селектор iframe'),
                Select::make('captcha_type')
                    ->label('Капча')
                    ->options([
                        'none' => 'Нет',
                        'yandex_smartcaptcha' => 'Yandex SmartCaptcha',
                        'google_recaptcha_v2' => 'Google reCAPTCHA v2',
                        'hcaptcha' => 'hCaptcha',
                    ])
                    ->default('none'),
                Select::make('captcha_yandex_mode')
                    ->label('Вид Yandex SmartCaptcha')
                    ->options([
                        'checkbox' => 'Галочка',
                        'slider' => 'Слайдер',
                    ])
                    ->visible(fn ($get): bool => ($get('captcha_type') ?? 'none') === 'yandex_smartcaptcha'),
                TextInput::make('captcha_iframe_selector')
                    ->label('Iframe капчи'),
                TextInput::make('captcha_checkbox_selector')
                    ->label('Чекбокс капчи (в iframe)'),
                TextInput::make('captcha_token_selector')
                    ->label('Поле токена капчи'),
                Textarea::make('success_text')
                    ->label('Текст успеха')
                    ->columnSpanFull(),
                Textarea::make('error_text')
                    ->label('Текст ошибки')
                    ->columnSpanFull(),
                TextInput::make('wait_after_submit_ms')
                    ->label('Ожидание после submit (мс)')
                    ->required()
                    ->numeric()
                    ->default(2000),
                Select::make('mapping_type')
                    ->label('Тип маппинга')
                    ->options(['auto' => 'Авто', 'manual' => 'Ручной'])
                    ->default('auto')
                    ->required(),
                TextInput::make('confidence')
                    ->label('Уверенность (%)')
                    ->required()
                    ->numeric()
                    ->default(0.0),
                Toggle::make('screenshot_enabled')
                    ->label('Делать скриншот для этого mapping')
                    ->required(),
                TextInput::make('screenshot_path')
                    ->label('Путь скриншота'),
                Textarea::make('name_coordinates')
                    ->label('Координаты имени (fallback JSON)')
                    ->helperText('Пример: {"x":120,"y":340}'),
                Textarea::make('phone_coordinates')
                    ->label('Координаты телефона (fallback JSON)')
                    ->helperText('Пример: {"x":150,"y":380}'),
                Textarea::make('submit_coordinates')
                    ->label('Координаты submit (fallback JSON)')
                    ->helperText('Пример: {"x":170,"y":420}'),
                Select::make('status')
                    ->label('Статус')
                    ->options(['draft' => 'Черновик', 'active' => 'Активен', 'failed' => 'Ошибка'])
                    ->default('draft')
                    ->required(),
            ]);
    }
}
