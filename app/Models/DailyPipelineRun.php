<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DailyPipelineRun extends Model
{
    protected $fillable = [
        'run_date',
        'status',
        'region_id',
        'query',
        'max_pages',
        'use_proxy',
        'scan_forms',
        'submit_forms',
        'submit_cycles_min',
        'submit_cycles_max',
        'submit_cycles_planned',
        'submit_cycle_current',
        'timezone',
        'start_time',
        'deadline_time',
        'discovery_run_id',
        'campaign_id',
        'promo_sites_count',
        'new_sites_count',
        'scan_queued_count',
        'forms_found_count',
        'forms_not_found_count',
        'submit_queued_count',
        'submit_success_count',
        'submit_failed_count',
        'submit_unknown_count',
        'error_message',
        'report',
        'alert_no_proxy_sent_at',
        'alert_zero_balance_sent_at',
        'summary_sent_at',
        'started_at',
        'deadline_at',
        'discovery_finished_at',
        'scan_finished_at',
        'submit_finished_at',
        'finished_at',
    ];

    protected function casts(): array
    {
        return [
            'run_date' => 'date',
            'max_pages' => 'integer',
            'use_proxy' => 'boolean',
            'scan_forms' => 'boolean',
            'submit_forms' => 'boolean',
            'submit_cycles_min' => 'integer',
            'submit_cycles_max' => 'integer',
            'submit_cycles_planned' => 'integer',
            'submit_cycle_current' => 'integer',
            'promo_sites_count' => 'integer',
            'new_sites_count' => 'integer',
            'scan_queued_count' => 'integer',
            'forms_found_count' => 'integer',
            'forms_not_found_count' => 'integer',
            'submit_queued_count' => 'integer',
            'submit_success_count' => 'integer',
            'submit_failed_count' => 'integer',
            'submit_unknown_count' => 'integer',
            'report' => 'array',
            'alert_no_proxy_sent_at' => 'datetime',
            'alert_zero_balance_sent_at' => 'datetime',
            'summary_sent_at' => 'datetime',
            'started_at' => 'datetime',
            'deadline_at' => 'datetime',
            'discovery_finished_at' => 'datetime',
            'scan_finished_at' => 'datetime',
            'submit_finished_at' => 'datetime',
            'finished_at' => 'datetime',
        ];
    }

    public function region(): BelongsTo
    {
        return $this->belongsTo(Region::class);
    }

    public function discoveryRun(): BelongsTo
    {
        return $this->belongsTo(DiscoveryRun::class);
    }

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    public function isActive(): bool
    {
        return in_array($this->status, ['pending', 'discovering', 'scanning', 'submitting'], true);
    }

    public function stageNumber(): int
    {
        return match ($this->status) {
            'pending', 'discovering' => 1,
            'scanning' => 2,
            'submitting' => 3,
            default => match (true) {
                $this->submit_finished_at !== null => 3,
                $this->scan_finished_at !== null => 2,
                $this->discovery_finished_at !== null => 1,
                default => 0,
            },
        };
    }

    public function stageLabel(): string
    {
        return match ($this->status) {
            'pending', 'discovering' => '1/3 Скан Яндекса',
            'scanning' => '2/3 Скан форм',
            'submitting' => '3/3 Отправка форм'
                .($this->submit_cycle_current > 0 ? " (круг {$this->submit_cycle_current})" : ''),
            'completed' => 'Готово (3/3)',
            'cancelled' => 'Остановлен',
            'failed' => 'Ошибка',
            'timeout' => 'Дедлайн',
            default => $this->status,
        };
    }

    public function statusLabel(): string
    {
        return match ($this->status) {
            'pending' => 'Ожидание',
            'discovering' => 'Скан Яндекса',
            'scanning' => 'Скан форм',
            'submitting' => 'Отправка форм',
            'completed' => 'Завершён',
            'cancelled' => 'Остановлен',
            'failed' => 'Ошибка',
            'timeout' => 'Дедлайн',
            default => $this->status,
        };
    }
}
