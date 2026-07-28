<?php

namespace App\Filament\Pages;

use App\Models\ProjectSetting;
use App\Models\Region;
use App\Support\RuntimeSettings;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Notifications\Notification;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Forms\Concerns\InteractsWithForms;
use Filament\Forms\Contracts\HasForms;
use Filament\Pages\Page;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;

class ProjectSettings extends Page implements HasForms
{
    use InteractsWithForms;

    protected string $view = 'filament.pages.project-settings';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedCog6Tooth;

    protected static ?string $navigationLabel = 'Настройки проекта';

    protected static string|\UnitEnum|null $navigationGroup = 'Лиды';

    public ?array $data = [];

    public function mount(): void
    {
        $settings = ProjectSetting::query()->firstOrCreate([]);

        // Default region: Москва, if not configured yet.
        if ($settings->pipeline_region_id === null) {
            $moscowId = Region::query()->where('name', 'Москва')->value('id');
            if ($moscowId) {
                $settings->pipeline_region_id = (int) $moscowId;
                $settings->save();
            }
        }

        if (blank($settings->pipeline_timezone)) {
            $settings->pipeline_timezone = 'Europe/Moscow';
            $settings->save();
        }

        // Seed integration fields from .env once, so existing secrets are not lost.
        $seed = [];
        if ((int) ($settings->bot_concurrency ?? 0) < 1) {
            $seed['bot_concurrency'] = max(1, min(8, (int) env('BOT_CONCURRENCY', 1)));
        }
        if (blank($settings->captcha_solver_provider)) {
            $seed['captcha_solver_provider'] = in_array(env('CAPTCHA_SOLVER_PROVIDER'), ['rucaptcha', '2captcha'], true)
                ? env('CAPTCHA_SOLVER_PROVIDER')
                : 'rucaptcha';
        }
        if (blank($settings->captcha_solver_api_key) && filled(env('CAPTCHA_SOLVER_API_KEY'))) {
            $seed['captcha_solver_api_key'] = (string) env('CAPTCHA_SOLVER_API_KEY');
        }
        if (blank($settings->telegram_bot_token) && filled(env('TELEGRAM_BOT_TOKEN'))) {
            $seed['telegram_bot_token'] = (string) env('TELEGRAM_BOT_TOKEN');
        }
        if (blank($settings->telegram_webhook_secret) && filled(env('TELEGRAM_WEBHOOK_SECRET'))) {
            $seed['telegram_webhook_secret'] = (string) env('TELEGRAM_WEBHOOK_SECRET');
        }

        // Hard defaults that are no longer editable.
        $settings->forceFill([
            ...$seed,
            'proxy_enabled' => true,
            'pipeline_use_proxy' => true,
            'pipeline_scan_forms' => true,
            'pipeline_submit_forms' => true,
            'enable_screenshots_global' => false,
            'screenshot_on_scan' => false,
            'screenshot_on_submit_success' => false,
            'screenshot_on_submit_failed' => false,
            'screenshot_on_unknown_result' => false,
        ])->save();

        RuntimeSettings::refresh();

        $this->form->fill($settings->fresh()->toArray());
    }

    public function form(Schema $schema): Schema
    {
        return $schema
            ->statePath('data')
            ->components([
                Section::make('Общие')
                    ->description('Только то, что реально влияет на скан/маппинг. Таймауты браузера, UA, viewport и локаль задаются воркером автоматически (по региону / fingerprint).')
                    ->columns(2)
                    ->schema([
                        TextInput::make('max_form_mappings_per_site')
                            ->label('Макс. авто-маппингов на сайт')
                            ->helperText('Сколько лучших форм сохранять после скана (рекомендуется 3–5).')
                            ->numeric()
                            ->minValue(1)
                            ->maxValue(10)
                            ->required(),
                        TextInput::make('wait_after_submit_ms')
                            ->label('Ожидание после отправки по умолчанию (мс)')
                            ->helperText('Подставляется в новые ручные маппинги, если не задано иначе.')
                            ->numeric()
                            ->required(),
                    ]),

                Section::make('Интеграции / Воркер')
                    ->description('Значения из админки имеют приоритет над .env. Bot-worker подтягивает concurrency и captcha через API.')
                    ->columns(2)
                    ->schema([
                        TextInput::make('bot_concurrency')
                            ->label('Параллельных браузеров (BOT_CONCURRENCY)')
                            ->helperText('1–8. Локально: 1. Прод 6CPU/6GB: 3.')
                            ->numeric()
                            ->minValue(1)
                            ->maxValue(8)
                            ->required(),
                        Select::make('captcha_solver_provider')
                            ->label('Провайдер капчи')
                            ->options([
                                'rucaptcha' => 'ruCaptcha',
                                '2captcha' => '2Captcha',
                            ])
                            ->required(),
                        TextInput::make('captcha_solver_api_key')
                            ->label('API-ключ капчи')
                            ->password()
                            ->revealable()
                            ->columnSpanFull(),
                        TextInput::make('telegram_bot_token')
                            ->label('Telegram bot token')
                            ->password()
                            ->revealable()
                            ->columnSpanFull(),
                        TextInput::make('telegram_webhook_secret')
                            ->label('Telegram webhook secret')
                            ->helperText('Должен совпадать с URL webhook: /api/telegram/webhook/{secret}')
                            ->password()
                            ->revealable()
                            ->columnSpanFull(),
                    ]),

                Section::make('Proxy')
                    ->description('Proxy обязателен всегда: скан Яндекса, скан форм и отправка. Без рабочих proxy задачи не стартуют.')
                    ->columns(2)
                    ->schema([
                        Toggle::make('rotate_proxy_before_each_site')
                            ->label('Менять IP перед каждым сайтом')
                            ->helperText('Если у proxy задан URL смены IP.'),
                        Toggle::make('check_ip_before_run')
                            ->label('Проверять IP перед запуском'),
                        TextInput::make('proxy_change_ip_timeout_ms')
                            ->label('Таймаут смены / проверки IP (мс)')
                            ->numeric()
                            ->required(),
                    ]),

                Section::make('Автопайплайн (крон)')
                    ->description('Крон `pipeline:tick` каждую минуту. Если включено — в окне старт→дедлайн создаётся прогон: поиск Promo → скан форм → отправка (всегда с proxy).')
                    ->columns(3)
                    ->schema([
                        Toggle::make('pipeline_enabled')->label('Включить автопайплайн'),
                        TextInput::make('pipeline_start_time')
                            ->label('Старт (ЧЧ:ММ)')
                            ->placeholder('09:00')
                            ->required(),
                        TextInput::make('pipeline_deadline_time')
                            ->label('Дедлайн (ЧЧ:ММ)')
                            ->placeholder('18:00')
                            ->required(),
                        TextInput::make('pipeline_timezone')
                            ->label('Часовой пояс')
                            ->placeholder('Europe/Moscow')
                            ->required(),
                        Select::make('pipeline_region_id')
                            ->label('Регион')
                            ->options(fn () => Region::query()->orderBy('name')->pluck('name', 'id')->all())
                            ->searchable()
                            ->required()
                            ->helperText('Без региона автопайплайн не стартует. Локаль/гео браузера берутся из региона.'),
                        TextInput::make('pipeline_query_template')
                            ->label('Шаблон запроса')
                            ->helperText('Плейсхолдер {регион}')
                            ->columnSpan(2),
                        TextInput::make('pipeline_max_pages')
                            ->label('Страниц выдачи')
                            ->numeric()
                            ->minValue(1)
                            ->maxValue(5)
                            ->required(),
                        TextInput::make('pipeline_telegram_chat_id')
                            ->label('Telegram chat_id для алертов')
                            ->helperText('Обязательно: нет proxy, сбой ruCaptcha, старт/финиш автопайплайна (успех и ошибка)')
                            ->columnSpan(2),
                    ]),
            ]);
    }

    protected function getHeaderActions(): array
    {
        return [
            Action::make('save')
                ->label('Сохранить')
                ->submit('save'),
        ];
    }

    public function save(): void
    {
        $settings = ProjectSetting::query()->firstOrCreate([]);
        $state = $this->form->getState();

        $settings->update([
            ...$state,
            'bot_concurrency' => max(1, min(8, (int) ($state['bot_concurrency'] ?? 1))),
            'proxy_enabled' => true,
            'pipeline_use_proxy' => true,
            'pipeline_scan_forms' => true,
            'pipeline_submit_forms' => true,
            'enable_screenshots_global' => false,
            'screenshot_on_scan' => false,
            'screenshot_on_submit_success' => false,
            'screenshot_on_submit_failed' => false,
            'screenshot_on_unknown_result' => false,
        ]);

        RuntimeSettings::refresh();

        Notification::make()
            ->title('Настройки сохранены')
            ->success()
            ->send();
    }
}
