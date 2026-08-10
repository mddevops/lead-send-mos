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
        'site_ids',
        'source',
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
        'pause_reason',
        'manual_stop',
        'report',
        'alert_no_proxy_sent_at',
        'alert_zero_balance_sent_at',
        'summary_sent_at',
        'started_at',
        'scheduled_start_at',
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
            'manual_stop' => 'boolean',
            'report' => 'array',
            'site_ids' => 'array',
            'alert_no_proxy_sent_at' => 'datetime',
            'alert_zero_balance_sent_at' => 'datetime',
            'summary_sent_at' => 'datetime',
            'started_at' => 'datetime',
            'scheduled_start_at' => 'datetime',
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

    /** Running or waiting to start (tick / stop targets). Not paused. */
    public function isActive(): bool
    {
        return in_array($this->status, ['pending', 'discovering', 'scanning', 'submitting'], true);
    }

    public function isPausedNoProxy(): bool
    {
        return $this->status === 'paused_no_proxy';
    }

    /** Can be stopped from UI (incl. scheduled pending and proxy pause). */
    public function isStoppable(): bool
    {
        return $this->isActive() || $this->isPausedNoProxy();
    }

    public function canAutoResume(): bool
    {
        if (! $this->isPausedNoProxy() || $this->manual_stop) {
            return false;
        }

        if ($this->deadline_at !== null && now()->greaterThanOrEqualTo($this->deadline_at)) {
            return false;
        }

        return true;
    }

    public function stageNumber(): int
    {
        return match ($this->status) {
            'pending', 'discovering', 'paused_no_proxy' => 1,
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
        $isManual = ($this->source ?? 'discovery') === 'sites';

        return match ($this->status) {
            'pending' => $this->scheduled_start_at
                ? 'Ожидание старта '.$this->scheduled_start_at->format('d.m H:i')
                : 'Ожидание',
            'discovering' => $isManual ? 'Подготовка сайтов' : '1/3 Скан Яндекса',
            'scanning' => $isManual
                ? ($this->submit_forms ? '1/2 Скан форм' : 'Скан форм')
                : '2/3 Скан форм',
            'submitting' => match (true) {
                $isManual && ! $this->scan_forms => 'Отправка форм'
                    .($this->submit_cycle_current > 0 ? " (круг {$this->submit_cycle_current})" : ''),
                $isManual => '2/2 Отправка форм'
                    .($this->submit_cycle_current > 0 ? " (круг {$this->submit_cycle_current})" : ''),
                default => '3/3 Отправка форм'
                    .($this->submit_cycle_current > 0 ? " (круг {$this->submit_cycle_current})" : ''),
            },
            'paused_no_proxy' => 'Пауза: нет прокси',
            'completed' => 'Готово',
            'cancelled' => 'Остановлен',
            'failed' => 'Ошибка',
            'timeout' => 'Дедлайн',
            default => $this->status,
        };
    }

    public function sitesCount(): int
    {
        if (is_array($this->site_ids) && $this->site_ids !== []) {
            return count($this->site_ids);
        }

        $reportCount = (int) ($this->report['sites_count'] ?? 0);
        if ($reportCount > 0) {
            return $reportCount;
        }

        return (int) $this->new_sites_count + (int) $this->promo_sites_count;
    }

    public function statusLabel(): string
    {
        return match ($this->status) {
            'pending' => 'Ожидание',
            'discovering' => 'Скан Яндекса',
            'scanning' => 'Скан форм',
            'submitting' => 'Отправка форм',
            'paused_no_proxy' => 'Пауза: нет прокси',
            'completed' => 'Завершён',
            'cancelled' => 'Остановлен',
            'failed' => 'Ошибка',
            'timeout' => 'Дедлайн',
            default => $this->status,
        };
    }
}
