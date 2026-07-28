<x-filament-panels::page>
    <div class="mb-4 space-y-3">
        <div class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
            <p class="text-sm text-gray-600 dark:text-gray-300">
                <strong>Сайт:</strong> {{ $this->record->name }}<br>
                <strong>URL:</strong>
                <a href="{{ $this->record->url }}" target="_blank" rel="noopener" class="text-primary-600 underline">
                    {{ $this->record->url }}
                </a><br>
                <strong>Статус:</strong> {{ $this->record->status }}
            </p>
        </div>

        <div class="rounded-lg border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100">
            <strong>Как настроить:</strong> откройте сайт в новой вкладке, в DevTools скопируйте
            <code class="rounded bg-white/60 px-1 dark:bg-black/30">id</code> или
            <code class="rounded bg-white/60 px-1 dark:bg-black/30">class</code> элементов и заполните шаги ниже.
            Селекторы собираются автоматически. Playwright на worker — опционально.
        </div>
    </div>

    <form wire:submit="saveMapping">
        {{ $this->form }}
    </form>
</x-filament-panels::page>
