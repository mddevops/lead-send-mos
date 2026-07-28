<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;

class TelegramBotConversation
{
    private const CACHE_PREFIX = 'telegram_conversation:';

    private const TTL_MINUTES = 30;

    public function start(string $chatId): void
    {
        Cache::put($this->key($chatId), [
            'step' => 'await_name',
        ], now()->addMinutes(self::TTL_MINUTES));
    }

    public function get(string $chatId): ?array
    {
        $state = Cache::get($this->key($chatId));

        return is_array($state) ? $state : null;
    }

    public function setName(string $chatId, string $name): void
    {
        Cache::put($this->key($chatId), [
            'step' => 'await_phone',
            'name' => $name,
        ], now()->addMinutes(self::TTL_MINUTES));
    }

    public function clear(string $chatId): void
    {
        Cache::forget($this->key($chatId));
    }

    private function key(string $chatId): string
    {
        return self::CACHE_PREFIX.$chatId;
    }
}
