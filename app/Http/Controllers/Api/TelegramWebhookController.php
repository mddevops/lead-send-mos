<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\BotTask;
use App\Models\Campaign;
use App\Models\CampaignSiteRun;
use App\Models\ProjectSetting;
use App\Models\Proxy;
use App\Models\Site;
use App\Support\ProxyPicker;
use App\Support\RuntimeSettings;
use App\Support\SubmitLeadPayloadBuilder;
use App\Services\TelegramBotConversation;
use App\Services\TelegramCampaignService;
use App\Services\TelegramNotifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class TelegramWebhookController extends Controller
{
    public function __invoke(
        Request $request,
        string $secret,
        TelegramNotifier $notifier,
        TelegramBotConversation $conversation,
        TelegramCampaignService $campaigns,
    ): JsonResponse {
        $expectedSecret = RuntimeSettings::telegramWebhookSecret();

        abort_if($expectedSecret === '' || ! hash_equals($expectedSecret, $secret), 403);

        $payload = $request->all();
        $message = $payload['message'] ?? null;

        if (! is_array($message)) {
            return response()->json(['ok' => true]);
        }

        $chatId = (string) ($message['chat']['id'] ?? '');
        $text = trim((string) ($message['text'] ?? ''));

        if ($chatId === '' || $text === '') {
            return response()->json(['ok' => true]);
        }

        if ($this->isHelpCommand($text)) {
            $notifier->sendMessage($chatId, $this->helpText());

            return response()->json(['ok' => true]);
        }

        if ($this->isQueueCommand($text)) {
            $notifier->sendMessage($chatId, $campaigns->listActiveForChat($chatId));

            return response()->json(['ok' => true]);
        }

        if ($stopId = $this->parseStopCommand($text)) {
            $notifier->sendMessage($chatId, $campaigns->cancelForChat($chatId, $stopId));

            return response()->json(['ok' => true]);
        }

        if ($this->isStartCommand($text)) {
            $conversation->start($chatId);
            $notifier->sendMessage(
                $chatId,
                "Здравствуйте!\n\nУкажите имя для заявки:\n\nКоманды: /queue — очередь, /stop ID — остановить"
            );

            return response()->json(['ok' => true]);
        }

        if ($this->isCancelCommand($text)) {
            $conversation->clear($chatId);
            $notifier->sendMessage($chatId, 'Ввод отменён. Нажмите /start, чтобы начать заново.');

            return response()->json(['ok' => true]);
        }

        $state = $conversation->get($chatId);

        if ($state === null) {
            $notifier->sendMessage($chatId, $this->helpText());

            return response()->json(['ok' => true]);
        }

        if (($state['step'] ?? null) === 'await_name') {
            $name = $this->normalizeName($text);

            if ($name === null) {
                $notifier->sendMessage($chatId, 'Имя слишком короткое. Укажите имя ещё раз:');

                return response()->json(['ok' => true]);
            }

            $conversation->setName($chatId, $name);
            $notifier->sendMessage($chatId, "Имя: {$name}\n\nУкажите номер телефона:");

            return response()->json(['ok' => true]);
        }

        if (($state['step'] ?? null) === 'await_phone') {
            $phone = $this->normalizePhone($text);

            if ($phone === null) {
                $notifier->sendMessage($chatId, 'Некорректный номер. Укажите телефон, например: +79991234567');

                return response()->json(['ok' => true]);
            }

            $name = (string) ($state['name'] ?? '');
            $conversation->clear($chatId);

            $result = $this->launchCampaignFromTelegram($name, $phone, $chatId);
            $notifier->sendMessage($chatId, $result);

            return response()->json(['ok' => true]);
        }

        $conversation->clear($chatId);
        $notifier->sendMessage($chatId, 'Сессия сброшена. Нажмите /start, чтобы начать заново.');

        return response()->json(['ok' => true]);
    }

    private function helpText(): string
    {
        return "Команды бота:\n"
            ."/start — запустить новую отправку\n"
            ."/queue — активные процессы и очередь\n"
            ."/stop 12 — остановить процесс #12\n"
            ."/cancel — отменить текущий ввод имени/телефона";
    }

    private function isHelpCommand(string $text): bool
    {
        $normalized = mb_strtolower($text);

        return in_array($normalized, ['/help', 'помощь', 'help'], true);
    }

    private function isQueueCommand(string $text): bool
    {
        $normalized = mb_strtolower($text);

        return in_array($normalized, ['/queue', '/status', 'очередь', 'статус'], true);
    }

    private function parseStopCommand(string $text): ?int
    {
        if (preg_match('/^\/?(?:stop|остановить)(?:@\w+)?\s+#?(\d+)\s*$/iu', $text, $matches)) {
            return (int) $matches[1];
        }

        return null;
    }

    private function isStartCommand(string $text): bool
    {
        $normalized = mb_strtolower($text);

        return $text === '/start'
            || str_starts_with($text, '/start ')
            || $normalized === 'начать'
            || $normalized === 'старт';
    }

    private function isCancelCommand(string $text): bool
    {
        $normalized = mb_strtolower($text);

        return in_array($normalized, ['/cancel', 'отмена', 'cancel'], true);
    }

    private function normalizeName(string $text): ?string
    {
        $name = trim($text);

        if (mb_strlen($name) < 2) {
            return null;
        }

        return $name;
    }

    private function normalizePhone(string $text): ?string
    {
        $digits = preg_replace('/\D+/', '', $text) ?? '';

        if (strlen($digits) < 10) {
            return null;
        }

        if (str_starts_with($digits, '8') && strlen($digits) === 11) {
            $digits = '7'.substr($digits, 1);
        }

        if (strlen($digits) === 10) {
            $digits = '7'.$digits;
        }

        return '+'.$digits;
    }

    private function launchCampaignFromTelegram(string $name, string $phone, string $chatId): string
    {
        $settings = ProjectSetting::query()->firstOrCreate([]);
        $sites = Site::query()->where('status', 'ready')->get();

        if ($sites->isEmpty()) {
            return 'Нет ready-сайтов. Сначала подготовьте сайты в админке.';
        }

        if (ProxyPicker::pick() === null) {
            app(\App\Services\DailyPipelineService::class)->notifyNoProxy('Отправка из Telegram не запущена.');

            return 'Нет рабочих proxy. Отправка не запущена.';
        }

        $campaign = Campaign::query()->create([
            'name' => $name,
            'phone' => $phone,
            'source' => 'telegram',
            'status' => 'queued',
            'total_sites' => $sites->count(),
            'success_count' => 0,
            'failed_count' => 0,
            'skipped_count' => 0,
            'unknown_count' => 0,
            'telegram_chat_id' => $chatId,
        ]);

        $skipped = 0;
        $queued = 0;
        $failed = 0;

        foreach ($sites as $site) {
            $run = CampaignSiteRun::query()->create([
                'campaign_id' => $campaign->id,
                'site_id' => $site->id,
                'phone' => $phone,
                'status' => 'pending',
            ]);

            $mapping = SubmitLeadPayloadBuilder::pickMapping($site);

            if (! $mapping) {
                $run->update([
                    'status' => 'skipped',
                    'skip_reason' => 'no_mapping',
                ]);
                $skipped++;
                continue;
            }

            $proxy = ProxyPicker::pick();

            if ($proxy === null) {
                $run->update([
                    'status' => 'failed',
                    'error_message' => 'proxy_required_but_not_available',
                ]);
                $failed++;
                continue;
            }

            $run->update([
                'proxy_id' => $proxy->id,
            ]);

            $this->prepareProxyForRun($proxy, $settings);

            $task = BotTask::query()->create([
                'type' => 'submit_lead',
                'status' => 'queued',
                'campaign_site_run_id' => $run->id,
                'site_id' => $site->id,
                'payload' => [
                    'taskId' => null,
                    'runId' => $run->id,
                    'url' => SubmitLeadPayloadBuilder::submitUrl($site, $mapping),
                    'name' => $name,
                    'phone' => $phone,
                    'region' => SubmitLeadPayloadBuilder::regionArray($site),
                    'screenshotConfig' => [
                        'enabled' => false,
                    ],
                    'mapping' => SubmitLeadPayloadBuilder::mappingArray($mapping),
                    'proxy' => ProxyPicker::toPayload($proxy),
                    'proxyConfig' => ProxyPicker::configFromSettings($settings),
                ],
            ]);

            $task->update([
                'payload' => [
                    ...($task->payload ?? []),
                    'taskId' => $task->id,
                ],
            ]);

            ProxyPicker::markUsed($proxy);

            $queued++;
        }

        $campaign->update([
            'skipped_count' => $skipped,
            'failed_count' => $failed,
            'status' => $queued > 0 ? 'queued' : ($failed > 0 ? 'completed_with_errors' : 'completed'),
        ]);

        if ($queued === 0) {
            $campaign->update(['telegram_status_notified_at' => now()]);

            return "Процесс #{$campaign->id} завершена.\nВсего сайтов: {$campaign->total_sites}\nУспешно: 0\nОшибки: {$failed}";
        }

        return "Процесс #{$campaign->id} отправки заявок запущен.\nИмя: {$name}\nТелефон: {$phone}\nСообщим об окончании.\n\nОчередь: /queue\nОстановить: /stop {$campaign->id}";
    }

    private function prepareProxyForRun(Proxy $proxy, ProjectSetting $settings): void
    {
        if ($settings->rotate_proxy_before_each_site && filled($proxy->change_ip_url)) {
            try {
                Http::timeout(max(1, (int) ceil(($settings->proxy_change_ip_timeout_ms ?? 10000) / 1000)))
                    ->get($proxy->change_ip_url);
            } catch (\Throwable) {
                // Rotate API fail ≠ dead proxy; keep active and continue with current IP.
            }
        }

        $proxy->update([
            'last_used_at' => now(),
            'cooldown_until' => null,
        ]);
    }
}
