<?php

namespace App\Services;

use App\Support\RuntimeSettings;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class TelegramNotifier
{
    public function sendMessage(string $chatId, string $text): bool
    {
        $token = RuntimeSettings::telegramBotToken();

        if ($token === '') {
            return false;
        }

        try {
            $response = Http::timeout(10)->post("https://api.telegram.org/bot{$token}/sendMessage", [
                'chat_id' => $chatId,
                'text' => $text,
            ]);

            return $response->successful();
        } catch (\Throwable $e) {
            Log::warning('telegram.send_failed', [
                'chat_id' => $chatId,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }
}
