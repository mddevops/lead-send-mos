# PROJECT PLAN

## Правила выполнения
- Работаем по MVP-задачам по порядку.
- После каждой задачи обновляем этот файл, фиксируем результат, следующий шаг и ждём подтверждение "да".
- Ограничения безопасности: только легитимные отправки по разрешённым сайтам. Без обхода CAPTCHA, взлома, сокрытия личности или спама.

## MVP-задачи
1. [x] Создать Laravel проект, Filament, auth, базовую админку.
2. [x] Создать модели и миграции: Site, FormMapping, Campaign, CampaignSiteRun, Proxy, ProjectSetting.
3. [x] Создать Filament Resources для Sites, FormMappings, Campaigns, CampaignSiteRuns, Proxies.
4. [x] Создать Settings Page.
5. [x] Создать Dashboard widget "Запустить ракету".
6. [x] Создать API endpoints для bot-worker.
7. [x] Создать `/bot-worker` на Node.js + TypeScript + Playwright.
8. [x] Реализовать `scan_form`.
9. [x] Реализовать `submit_lead`.
10. [x] Реализовать screenshots settings.
11. [x] Реализовать proxy pool.
12. [x] Реализовать result detection.
13. [x] Реализовать историю и просмотр скриншотов.
14. [x] Добавить ручную настройку формы.
15. [x] Добавить тестовые сценарии и seeders.

## Текущий статус
- Выполнена: Задача 15.
- Следующая: MVP завершён. При желании можно перейти к post-MVP (очередь/worker-polling/Horizon).

## Лог выполнения
### Задача 1
- Создан новый Laravel-проект (актуальная стабильная версия).
- Установлен Filament (актуальная стабильная версия) и создан `AdminPanelProvider`.
- Подготовлена базовая авторизация для входа в панель: `User` реализует `FilamentUser`.
- Создан тестовый админ-пользователь: `admin@example.com` / `password` (для локальной разработки, сменить позже).

### Задача 2
- Созданы модели и миграции: `Site`, `FormMapping`, `Campaign`, `CampaignSiteRun`, `Proxy`, `ProjectSetting`.
- Миграции заполнены полями из ТЗ: статусы, связи, nullable-поля, поля детекции результата, скриншоты, прокси и глобальные настройки проекта.
- В моделях добавлены `fillable`, `casts` и Eloquent-связи.
- В `Proxy` добавлено шифрование пароля через `Crypt` (не хранится в plain text).
- Миграции успешно применены в MySQL.

### Задача 3
- Сгенерированы Filament Resources для `Site`, `FormMapping`, `Campaign`, `CampaignSiteRun`, `Proxy` на базе структуры БД.
- Настроены формы и таблицы для CRUD по всем 5 сущностям.
- В `Sites` добавлены бизнес-действия: "Найти форму", "Открыть ручную настройку", "Проверить отправку", "Отключить сайт" (MVP-заглушки, интеграция с очередями будет добавлена в следующих задачах).
- Улучшены поля форм: `created_by` как связь с пользователем, JSON fallback-поля координат в mappings, безопасная обработка пароля proxy в форме.
- Ресурсы сгруппированы в навигации Filament (`Lead Send`), маршруты `/admin/*` успешно зарегистрированы.

### Задача 4
- Создана отдельная Filament Page `ProjectSettings` (`/admin/project-settings`) для динамических настроек проекта.
- Реализована форма-синглтон для `ProjectSetting` с сохранением в БД: разделы Общие, Скриншоты, Браузер/Bot, Proxy.
- Добавлено сохранение настроек через action "Сохранить" и уведомление об успешном сохранении.
- Полностью русифицированы текущие Filament Resources: навигация, названия сущностей, labels в формах и таблицах, статусы в select-полях.

### Задача 5
- Добавлен Dashboard Widget `RocketLaunchWidget` с кнопкой "Запустить ракету".
- Реализована модальная форма запуска: поля `Имя`, `Телефон`, режим выбора сайтов (все ready / вручную), ручной выбор ready-сайтов, флаг скриншотов для кампании.
- Реализована серверная логика создания `Campaign` и `CampaignSiteRun`:
  - для сайтов без активного mapping сразу создаётся `skipped` с `skip_reason = no_mapping`;
  - для сайтов с активным mapping создаётся `pending`.
- Виджет подключен в `AdminPanelProvider` и отображается на Dashboard.
- Проверка маршрутов/кода прошла успешно.

### Задача 6
- Подключены API-роуты Laravel для bot-worker в `routes/api.php`:
  - `POST /api/bot/tasks/{task}/started`
  - `POST /api/bot/tasks/{task}/completed`
  - `POST /api/bot/tasks/{task}/failed`
  - `POST /api/bot/sites/{site}/mapping`
  - `POST /api/bot/campaign-runs/{run}/result`
  - `POST /api/bot/screenshots`
- Добавлен middleware `BotApiTokenMiddleware` с Bearer token проверкой через `BOT_API_TOKEN`.
- Добавлен `BotWebhookController` с валидациями payload и обновлением сущностей (`CampaignSiteRun`, `Site`, `FormMapping`).
- Добавлен endpoint сохранения скриншота (`base64` -> storage disk, возврат пути).
- Подключён `api` роутинг в `bootstrap/app.php` и добавлена конфигурация `services.bot_worker.token`.

### Задача 7
- Создана папка `/bot-worker` и инициализирован Node.js проект на TypeScript.
- Установлены зависимости runtime/dev, включая Playwright и браузеры (`npx playwright install`).
- Добавлены скрипты:
  - `npm run dev`
  - `npm run worker`
  - `npm run build`
- Создана структура файлов по ТЗ:
  - `src/index.ts`
  - `src/playwright/browser.ts`
  - `src/tasks/scanForm.ts`
  - `src/tasks/submitLead.ts`
  - `src/tasks/manualMapping.ts`
  - `src/services/proxyManager.ts`
  - `src/services/screenshotService.ts`
  - `src/services/resultDetector.ts`
  - `src/services/laravelApi.ts`
  - `src/utils/selectors.ts`
  - `src/config.ts`
- Добавлен `.env.example` для worker и базовая валидация конфигурации.
- Проверен запуск: `npm run dev` и `npm run worker` стартуют корректно в idle-режиме.

### Задача 8
- Добавлена серверная сущность задач worker: `BotTask` + миграция `bot_tasks` (`type`, `status`, `payload`, `site_id`, `campaign_site_run_id`, тайминги, ошибки).
- Действие "Найти форму" в `SiteResource` теперь создаёт реальную задачу `scan_form` в `bot_tasks`, переводит сайт в `scanning` и формирует payload для worker.
- Учтены screenshot-настройки проекта при постановке `scan_form` (глобальный флаг + `screenshot_on_scan`).
- API callbacks `/api/bot/tasks/{task}/started|completed|failed` переведены на работу с `BotTask` (вместо прямой привязки к `campaign_site_runs`).
- При наличии `campaign_site_run_id` callback также синхронизирует статусы run-записи.

### Задача 9
- В `RocketLaunchWidget` запуск кампании теперь создаёт `BotTask` типа `submit_lead` для каждого валидного сайта.
- Реализованы проверки перед постановкой `submit_lead`:
  - `site disabled` -> `skipped (site_disabled)`;
  - `site not ready` -> `skipped (site_not_ready)`;
  - `no active mapping` -> `skipped (no_mapping)`;
  - `proxy enabled`, но нет доступного proxy -> `failed (proxy_required_but_not_available)`.
- В payload `submit_lead` передаются URL, данные лида, активный mapping, флаг скриншотов кампании и proxy-данные.
- API `campaignRunResult` теперь:
  - завершает связанный `BotTask`;
  - пересчитывает счётчики кампании (`success/failed/skipped/unknown`);
  - обновляет статус кампании (`processing` / `completed` / `completed_with_errors`) и `finished_at`.
- Worker `submitLead` расширен: дополнительно отправляет `http_status`, `response_url`, `response_text`, причины детекции и скриншоты.

### Задача 10
- Добавлено поле `screenshot_quality` в `project_settings` (миграция + настройки страницы + модель).
- В `ProjectSettings` добавлен параметр "Качество скриншота (1-100)".
- В payload `scan_form` и `submit_lead` теперь передаётся полноценная `screenshotConfig`:
  - `enabled`
  - `disk`
  - `fullPage`
  - `quality`
  - для `submit_lead`: `on_success`, `on_failed`, `on_unknown`.
- Worker `scanForm` и `submitLead` обновлены для работы с `screenshotConfig`.
- Реализована условная логика сохранения скриншотов после submit:
  - success -> только если `screenshot_on_submit_success`
  - failed -> только если `screenshot_on_submit_failed`
  - unknown -> только если `screenshot_on_unknown_result`
- Скриншот-сервис теперь поддерживает выбор `disk`, `fullPage`, `quality` и jpeg/png форматы.

### Задача 11
- В worker добавлена поддержка proxy auth (`server + username + password`) при запуске Playwright.
- Реализованы функции `rotateProxyIfNeeded` и `checkIpBeforeRunIfNeeded` в `proxyManager` (с timeout).
- В payload `submit_lead` добавлены:
  - `proxy.changeIpUrl`
  - `proxyConfig.rotate_before_each_site`
  - `proxyConfig.check_ip_before_run`
  - `proxyConfig.proxy_change_ip_timeout_ms`.
- В Laravel `RocketLaunchWidget`:
  - прокси выбирается только из доступных active и не в cooldown;
  - перед запуском возможно rotate IP через `change_ip_url`;
  - фиксируются `last_used_at`, `cooldown_until`, `status` у прокси.
- В callback `campaignRunResult` добавлена синхронизация состояния proxy:
  - `success` -> `active`, сброс cooldown;
  - `failed/unknown` -> `cooldown` на `proxy_cooldown_seconds`.

### Задача 12
- Усилен `resultDetector` в worker: кроме selector/text теперь учитываются:
  - изменение URL после submit;
  - наличие HTTP status из network response;
  - факт изменения страницы (hash до/после submit).
- Добавлены новые причины детекции:
  - `http_status_<code>` для success/failed сценариев;
  - `url_changed`;
  - `page_changed_but_no_explicit_signal`;
  - fallback `unknown_result`.
- В `submitLead` добавлены сбор и передача данных для детекции:
  - `initialUrl` / `finalUrl`;
  - `initialContentHash` / `finalContentHash`;
  - `responseStatus`.

### Задача 13
- Расширена история в `CampaignSiteRunsTable`:
  - добавлены поля: `response_text`, `error_message`, `response_url`, `http_status`, причины детекции, длительность, скриншоты.
- Добавлены фильтры истории:
  - `status` (`success/failed/skipped/unknown/...`);
  - `site`;
  - `campaign`;
  - `phone` (через связанную кампанию);
  - `date range` (по `created_at`).
- На странице Campaign detail (`EditCampaign`) добавлен Relation Manager `RunsRelationManager`:
  - таблица результатов по сайтам внутри кампании;
  - фильтры `status`, `phone`, `date range`;
  - быстрые действия открытия `screenshot_before` и `screenshot_after`.

### Задача 14
- Добавлена Filament-страница `ManualSiteMapping` (`/admin/sites/{id}/manual-mapping`):
  - форма CSS-селекторов и JSON-координат (fallback);
  - действия «Открыть сессию Playwright», «Сохранить черновик», «Сохранить и активировать».
- Добавлен `ManualMappingSaver` для сохранения `FormMapping` типа `manual` и перевода сайта в `ready` / `needs_manual_mapping`.
- В таблице сайтов действие «Открыть ручную настройку» ведёт на страницу manual mapping (вместо заглушки).
- В worker реализован `manual_mapping_session`:
  - headed Chromium (`headless: false`);
  - proxy rotate/check по настройкам;
  - скриншот при scan, валидация селекторов на странице, callback `POST /api/bot/sites/{site}/mapping`;
  - удержание сессии ~3 минуты для ручной работы в окне браузера.
- `openBrowser` поддерживает override `headless` на задачу.

### Задача 15
- Добавлен сидер `LeadSendDemoSeeder` с демонстрационными данными MVP:
  - админ `admin@example.com` / `password`;
  - `ProjectSetting` с рабочими дефолтами;
  - сайты в состояниях `ready`, `needs_manual_mapping`, `disabled`;
  - авто/ручной `FormMapping`, proxy, demo-кампания, run и `BotTask`.
- `DatabaseSeeder` переключён на вызов `LeadSendDemoSeeder`.
- Добавлены feature-тесты `BotWebhookControllerTest`:
  - защита API по `BOT_API_TOKEN`;
  - сохранение manual mapping без перезаписи auto mapping;
  - обработка `campaignRunResult` (обновление run/task, пересчёт campaign, cooldown proxy).
- Прогон тестов: `php artisan test` — успешно (`5 passed`).
