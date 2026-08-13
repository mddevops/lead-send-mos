<?php

namespace App\Filament\Resources\Sites\Pages;

use App\Filament\Resources\Sites\SiteResource;
use App\Models\FormMapping;
use App\Models\Site;
use App\Support\CssSelectorBuilder;
use App\Support\ManualMappingSaver;
use Filament\Actions\Action;
use Filament\Forms\Components\Placeholder;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Concerns\InteractsWithForms;
use Filament\Forms\Contracts\HasForms;
use Filament\Notifications\Notification;
use Filament\Resources\Pages\Page;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\HtmlString;

class ManualSiteMapping extends Page implements HasForms
{
    use InteractsWithForms;

    protected static string $resource = SiteResource::class;

    protected static ?string $title = 'Ручная настройка формы';

    protected static ?string $navigationLabel = 'Ручная настройка';

    protected string $view = 'filament.resources.sites.pages.manual-site-mapping';

    public Site $record;

    public ?array $data = [];

    public function mount(Site|int|string $record): void
    {
        $this->record = $record instanceof Site
            ? $record
            : Site::query()->findOrFail($record);

        $mapping = $this->record->formMappings()
            ->where('mapping_type', 'manual')
            ->latest()
            ->first();

        $nameParts = CssSelectorBuilder::parse($mapping?->name_selector);
        $phoneParts = CssSelectorBuilder::parse($mapping?->phone_selector);
        $submitParts = CssSelectorBuilder::parse($mapping?->submit_selector);
        $openParts = CssSelectorBuilder::parse($mapping?->open_modal_selector);
        $consentParts = CssSelectorBuilder::parse($mapping?->consent_checkbox_selector);
        $formScope = $mapping?->form_scope_selector ?? $this->inferFormScopeFromSelectors($mapping);

        $scopeParts = CssSelectorBuilder::parse($formScope);

        $consentSelectors = is_array($mapping?->consent_checkbox_selectors)
            ? array_values(array_filter($mapping->consent_checkbox_selectors))
            : [];

        $this->form->fill([
            'name_selector' => $mapping?->name_selector,
            'first_name_selector' => $mapping?->first_name_selector,
            'last_name_selector' => $mapping?->last_name_selector,
            'phone_selector' => $mapping?->phone_selector,
            'email_selector' => $mapping?->email_selector,
            'select_selectors' => is_array($mapping?->select_selectors)
                ? implode("\n", $mapping->select_selectors)
                : null,
            'submit_selector' => $mapping?->submit_selector,
            'open_modal_selector' => $mapping?->open_modal_selector,
            'form_scope_selector' => $formScope,
            'consent_checkbox_selector' => $mapping?->consent_checkbox_selector ?? ($consentSelectors[0] ?? null),
            'consent_checkbox_2_selector' => $consentSelectors[1] ?? null,
            'success_selector' => $mapping?->success_selector,
            'error_selector' => $mapping?->error_selector,
            'iframe_selector' => $mapping?->iframe_selector,
            'captcha_type' => $mapping?->captcha_type ?? 'none',
            'captcha_yandex_mode' => $mapping?->captcha_yandex_mode ?? 'checkbox',
            'captcha_iframe_selector' => $mapping?->captcha_iframe_selector,
            'captcha_checkbox_selector' => $mapping?->captcha_checkbox_selector,
            'captcha_token_selector' => $mapping?->captcha_token_selector,
            'success_text' => $mapping?->success_text,
            'error_text' => $mapping?->error_text,
            'wait_after_submit_ms' => $mapping?->wait_after_submit_ms ?? 2000,
            'name_coordinates' => $mapping?->name_coordinates ? json_encode($mapping->name_coordinates, JSON_UNESCAPED_UNICODE) : null,
            'phone_coordinates' => $mapping?->phone_coordinates ? json_encode($mapping->phone_coordinates, JSON_UNESCAPED_UNICODE) : null,
            'submit_coordinates' => $mapping?->submit_coordinates ? json_encode($mapping->submit_coordinates, JSON_UNESCAPED_UNICODE) : null,
            'screenshot_enabled' => (bool) ($mapping?->screenshot_enabled ?? false),
            'builder_open_tag' => $openParts['tag'],
            'builder_open_id' => $openParts['id'],
            'builder_open_class' => $openParts['class'],
            'builder_name_tag' => $nameParts['tag'] ?? 'input',
            'builder_name_id' => $nameParts['id'],
            'builder_name_class' => $nameParts['class'],
            'builder_name_name' => $nameParts['name'],
            'builder_name_type' => $nameParts['type'],
            'builder_phone_tag' => $phoneParts['tag'] ?? 'input',
            'builder_phone_id' => $phoneParts['id'],
            'builder_phone_class' => $phoneParts['class'],
            'builder_phone_name' => $phoneParts['name'],
            'builder_phone_type' => $phoneParts['type'],
            'builder_submit_tag' => $submitParts['tag'] ?? 'button',
            'builder_submit_id' => $submitParts['id'],
            'builder_submit_class' => $submitParts['class'],
            'builder_submit_name' => $submitParts['name'],
            'builder_submit_type' => $submitParts['type'],
            'builder_consent_tag' => $consentParts['tag'] ?? 'input',
            'builder_consent_id' => $consentParts['id'],
            'builder_consent_class' => $consentParts['class'],
            'builder_consent_name' => $consentParts['name'],
            'builder_consent_type' => $consentParts['type'],
            'builder_scope_tag' => $scopeParts['tag'],
            'builder_scope_id' => $scopeParts['id'],
            'builder_scope_class' => $scopeParts['class'],
        ]);
    }

    public static function canAccess(array $parameters = []): bool
    {
        return true;
    }

    public function form(Schema $schema): Schema
    {
        return $schema
            ->statePath('data')
            ->components([
                Section::make('Шаг 1 — открыть форму (если в модалке)')
                    ->description('Кнопка «Обратный звонок», «Оставить заявку» и т.п. Оставьте пустым, если форма уже видна на странице.')
                    ->columns(3)
                    ->schema([
                        TextInput::make('builder_open_tag')->label('Тег')->placeholder('button, a'),
                        TextInput::make('builder_open_id')->label('ID')->placeholder('callback-open'),
                        TextInput::make('builder_open_class')->label('Класс')->placeholder('btn callback'),
                    ]),
                Section::make('Шаг 2 — область формы (опционально)')
                    ->description('Контейнер модалки или блока формы. Воркер ищет поля только внутри этого селектора (например, #popup-feedback или form#callback).')
                    ->columns(3)
                    ->schema([
                        TextInput::make('builder_scope_tag')->label('Тег контейнера')->placeholder('form, div'),
                        TextInput::make('builder_scope_id')->label('ID контейнера')->placeholder('lead-form'),
                        TextInput::make('builder_scope_class')->label('Класс контейнера')->placeholder('modal-form'),
                    ]),
                Section::make('Шаг 3 — поля формы')
                    ->description('Укажите id/class/name из DevTools. Если id/class одинаковые, используйте атрибут name.')
                    ->schema([
                        ...$this->fieldBuilderSection('Имя', 'name', 'input'),
                        ...$this->fieldBuilderSection('Телефон', 'phone', 'input'),
                        ...$this->fieldBuilderSection('Кнопка отправки', 'submit', 'button'),
                        ...$this->fieldBuilderSection('Чекбокс согласия 1', 'consent', 'input'),
                    ]),
                Section::make('Шаг 4 — проверка успеха (рекомендуется)')
                    ->columns(2)
                    ->schema([
                        TextInput::make('success_selector')->label('Селектор блока успеха'),
                        Textarea::make('success_text')->label('Текст успеха (если нет селектора)')->columnSpanFull(),
                        TextInput::make('error_selector')->label('Селектор ошибки'),
                        TextInput::make('wait_after_submit_ms')->label('Ожидание после отправки (мс)')->numeric()->default(2000),
                    ]),
                Section::make('Капча')
                    ->description('Если на форме есть Yandex SmartCaptcha или аналог, выберите тип. Для Yandex укажите вид: галочка или слайдер.')
                    ->schema([
                        Select::make('captcha_type')
                            ->label('Тип капчи')
                            ->options([
                                'none' => 'Нет',
                                'yandex_smartcaptcha' => 'Yandex SmartCaptcha',
                                'google_recaptcha_v2' => 'Google reCAPTCHA v2',
                                'hcaptcha' => 'hCaptcha',
                            ])
                            ->default('none')
                            ->live()
                            ->afterStateUpdated(function (?string $state, callable $set): void {
                                if ($state === 'yandex_smartcaptcha') {
                                    $set('captcha_yandex_mode', 'checkbox');
                                    self::applyYandexCaptchaDefaults($set, 'checkbox');

                                    return;
                                }

                                $set('captcha_yandex_mode', null);
                            })
                            ->required(),
                        Select::make('captcha_yandex_mode')
                            ->label('Вид Yandex SmartCaptcha')
                            ->options([
                                'checkbox' => 'Галочка',
                                'slider' => 'Слайдер',
                            ])
                            ->default('checkbox')
                            ->live()
                            ->afterStateUpdated(fn (?string $state, callable $set) => self::applyYandexCaptchaDefaults($set, $state ?? 'checkbox'))
                            ->visible(fn ($get): bool => ($get('captcha_type') ?? 'none') === 'yandex_smartcaptcha')
                            ->required(fn ($get): bool => ($get('captcha_type') ?? 'none') === 'yandex_smartcaptcha'),
                        Placeholder::make('captcha_hint')
                            ->label('')
                            ->content(function ($get): HtmlString {
                                $mode = $get('captcha_yandex_mode') ?? 'checkbox';
                                $modeHint = $mode === 'slider'
                                    ? 'Воркер потянет ползунок в iframe. Для силуэта перебирает позиции по треку.'
                                    : 'Воркер кликнет галочку в iframe. На боевых сайтах часто появляется «текст с картинки» — такую задачу воркер не решает.';

                                return new HtmlString(
                                    '<span class="text-sm text-gray-500">'.$modeHint
                                    .' Для тестов используйте <a href="https://yandex.cloud/ru/docs/smartcaptcha/quickstart" target="_blank" class="underline">тестовые ключи Yandex</a>.</span>',
                                );
                            })
                            ->columnSpanFull()
                            ->visible(fn ($get): bool => ($get('captcha_type') ?? 'none') !== 'none'),
                        TextInput::make('captcha_iframe_selector')
                            ->label('Фрейм капчи')
                            ->placeholder('iframe[src*="smartcaptcha"]')
                            ->visible(fn ($get): bool => ($get('captcha_type') ?? 'none') !== 'none'),
                        TextInput::make('captcha_checkbox_selector')
                            ->label(fn ($get): string => ($get('captcha_yandex_mode') ?? 'checkbox') === 'slider'
                                ? 'Ползунок внутри iframe'
                                : 'Чекбокс внутри iframe')
                            ->placeholder(fn ($get): string => ($get('captcha_yandex_mode') ?? 'checkbox') === 'slider'
                                ? '#captcha-slider'
                                : '[role="checkbox"]')
                            ->visible(fn ($get): bool => ($get('captcha_type') ?? 'none') !== 'none'),
                        TextInput::make('captcha_token_selector')
                            ->label('Скрытое поле токена')
                            ->placeholder('input[name="smart-token"]')
                            ->visible(fn ($get): bool => ($get('captcha_type') ?? 'none') !== 'none'),
                    ]),
                Section::make('Итоговые CSS-селекторы')
                    ->description('Собираются кнопкой «Собрать селекторы» или при сохранении. Можно править вручную.')
                    ->collapsed()
                    ->columns(2)
                    ->schema([
                        TextInput::make('open_modal_selector')->label('Открыть форму'),
                        TextInput::make('form_scope_selector')->label('Область формы (шаг 2)'),
                        TextInput::make('name_selector')->label('ФИО (одно поле)'),
                        TextInput::make('first_name_selector')->label('Имя (отдельное)'),
                        TextInput::make('last_name_selector')->label('Фамилия (отдельное)'),
                        TextInput::make('phone_selector')->label('Телефон'),
                        TextInput::make('email_selector')->label('Эл. почта'),
                        Textarea::make('select_selectors')
                            ->label('Выпадающие списки (по одному селектору в строке)')
                            ->helperText('Дилер / модель / любой required select — бот выберет случайный option.')
                            ->formatStateUsing(function ($state): ?string {
                                if (is_array($state)) {
                                    return implode("\n", array_values(array_filter($state)));
                                }

                                return is_string($state) ? $state : null;
                            })
                            ->dehydrateStateUsing(function ($state): ?array {
                                if (! is_string($state) || trim($state) === '') {
                                    return null;
                                }

                                return array_values(array_filter(array_map('trim', preg_split('/\r\n|\r|\n/', $state) ?: [])));
                            })
                            ->columnSpanFull(),
                        TextInput::make('consent_checkbox_selector')->label('Чекбокс согласия 1'),
                        TextInput::make('consent_checkbox_2_selector')
                            ->label('Чекбокс согласия 2')
                            ->placeholder('#agree2')
                            ->helperText('Если на форме два согласия — укажите второй селектор.'),
                        TextInput::make('submit_selector')->label('Кнопка отправки'),
                        Placeholder::make('selector_hint')
                            ->label('')
                            ->content(new HtmlString('<span class="text-sm text-gray-500">Пример: <code>#lead-form input.phone</code></span>'))
                            ->columnSpanFull(),
                    ]),
            ]);
    }

    protected function getHeaderActions(): array
    {
        return [
            Action::make('open_site')
                ->label('Открыть сайт')
                ->icon('heroicon-o-arrow-top-right-on-square')
                ->color('gray')
                ->url(fn (): string => $this->record->url)
                ->openUrlInNewTab(),
            Action::make('apply_builders')
                ->label('Собрать селекторы')
                ->icon('heroicon-o-wrench-screwdriver')
                ->color('info')
                ->action(fn () => $this->applyBuilderSelectors()),
            Action::make('save_draft')
                ->label('Сохранить черновик')
                ->action(fn () => $this->saveMapping(activate: false)),
            Action::make('save')
                ->label('Сохранить и активировать')
                ->color('success')
                ->action(fn () => $this->saveMapping(activate: true)),
        ];
    }

    public function applyBuilderSelectors(): void
    {
        $state = $this->form->getState();
        $merged = $this->mergeBuilderIntoSelectors($state);
        $this->form->fill($merged);

        Notification::make()
            ->title('Селекторы собраны')
            ->body('Проверьте блок «Итоговые CSS-селекторы» и сохраните маппинг.')
            ->success()
            ->send();
    }

    public function saveMapping(bool $activate = true): void
    {
        $data = $this->mergeBuilderIntoSelectors($this->form->getState());

        if ($activate) {
            Validator::make($data, [
                'name_selector' => ['nullable', 'string'],
                'first_name_selector' => ['nullable', 'string'],
                'last_name_selector' => ['nullable', 'string'],
                'email_selector' => ['nullable', 'string'],
                'phone_selector' => ['required', 'string'],
                'submit_selector' => ['required', 'string'],
            ], [
                'phone_selector.required' => 'Заполните поле «Телефон» (шаг 3) или итоговый селектор.',
                'submit_selector.required' => 'Заполните кнопку submit (шаг 3) или итоговый селектор.',
            ])->validate();
        }

        ManualMappingSaver::save($this->record, $data, $activate);

        Notification::make()
            ->title($activate ? 'Маппинг сохранён, сайт готов' : 'Черновик маппинга сохранён')
            ->success()
            ->send();

        $this->redirect(SiteResource::getUrl('index'));
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function mergeBuilderIntoSelectors(array $data): array
    {
        $data['form_scope_selector'] = CssSelectorBuilder::build([
            'tag' => $data['builder_scope_tag'] ?? null,
            'id' => $data['builder_scope_id'] ?? null,
            'class' => $data['builder_scope_class'] ?? null,
        ]);

        $data['open_modal_selector'] = CssSelectorBuilder::build([
            'tag' => $data['builder_open_tag'] ?? null,
            'id' => $data['builder_open_id'] ?? null,
            'class' => $data['builder_open_class'] ?? null,
        ]);

        $fieldMap = [
            'name' => 'name_selector',
            'phone' => 'phone_selector',
            'submit' => 'submit_selector',
            'consent' => 'consent_checkbox_selector',
        ];

        $optionalFromBuilder = ['consent'];

        foreach ($fieldMap as $prefix => $selectorKey) {
            $built = CssSelectorBuilder::build([
                'tag' => $data["builder_{$prefix}_tag"] ?? null,
                'id' => $data["builder_{$prefix}_id"] ?? null,
                'class' => $data["builder_{$prefix}_class"] ?? null,
                'name' => $data["builder_{$prefix}_name"] ?? null,
                'type' => $data["builder_{$prefix}_type"] ?? null,
            ]);

            if ($built) {
                $data[$selectorKey] = $built;

                continue;
            }

            if (in_array($prefix, $optionalFromBuilder, true) || $this->isBuilderGroupEmpty($data, $prefix)) {
                $data[$selectorKey] = null;
            }
        }

        $secondConsent = trim((string) ($data['consent_checkbox_2_selector'] ?? ''));
        $firstConsent = trim((string) ($data['consent_checkbox_selector'] ?? ''));
        $consentList = array_values(array_filter([$firstConsent !== '' ? $firstConsent : null, $secondConsent !== '' ? $secondConsent : null]));
        $data['consent_checkbox_selectors'] = $consentList === [] ? null : $consentList;
        if ($firstConsent === '' && $consentList !== []) {
            $data['consent_checkbox_selector'] = $consentList[0];
        }

        if (($data['captcha_type'] ?? 'none') === 'none') {
            $data['captcha_yandex_mode'] = null;
            $data['captcha_iframe_selector'] = null;
            $data['captcha_checkbox_selector'] = null;
            $data['captcha_token_selector'] = null;
        } elseif (($data['captcha_type'] ?? 'none') !== 'yandex_smartcaptcha') {
            $data['captcha_yandex_mode'] = null;
        }

        return $data;
    }

    private static function applyYandexCaptchaDefaults(callable $set, string $mode): void
    {
        $set('captcha_iframe_selector', 'iframe[src*="smartcaptcha"]');
        $set('captcha_token_selector', 'input[name="smart-token"]');
        $set(
            'captcha_checkbox_selector',
            $mode === 'slider' ? '#captcha-slider' : '[role="checkbox"]',
        );
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function isBuilderGroupEmpty(array $data, string $prefix): bool
    {
        foreach (['tag', 'id', 'class', 'name', 'type'] as $part) {
            if (filled($data["builder_{$prefix}_{$part}"] ?? null)) {
                return false;
            }
        }

        return true;
    }

    private function inferFormScopeFromSelectors(?FormMapping $mapping): ?string
    {
        if ($mapping === null) {
            return null;
        }

        foreach ([$mapping->name_selector, $mapping->phone_selector, $mapping->submit_selector] as $selector) {
            if (blank($selector)) {
                continue;
            }

            if (preg_match('/^(#[a-z0-9_-]+|form#[a-z0-9_-]+)\s+/i', (string) $selector, $matches)) {
                return $matches[1];
            }
        }

        return null;
    }

    /**
     * @return array<int, Section>
     */
    private function fieldBuilderSection(string $title, string $prefix, string $defaultTag): array
    {
        return [
            Section::make($title)
                ->columns(5)
                ->schema([
                    TextInput::make("builder_{$prefix}_tag")
                        ->label('Тег')
                        ->default($defaultTag)
                        ->placeholder($defaultTag),
                    TextInput::make("builder_{$prefix}_id")
                        ->label('ID')
                        ->placeholder('field-name'),
                    TextInput::make("builder_{$prefix}_class")
                        ->label('Класс')
                        ->placeholder('form-control'),
                    TextInput::make("builder_{$prefix}_name")
                        ->label('Атрибут name')
                        ->placeholder('phone, name, consent'),
                    TextInput::make("builder_{$prefix}_type")
                        ->label('Тип')
                        ->placeholder('text, tel, submit, checkbox'),
                ]),
        ];
    }

}
