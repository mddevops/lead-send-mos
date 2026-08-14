<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Model;

class CampaignSiteRun extends Model
{
    use HasFactory;

    protected $fillable = [
        'campaign_id',
        'site_id',
        'proxy_id',
        'phone',
        'status',
        'skip_reason',
        'error_message',
        'response_text',
        'response_url',
        'http_status',
        'detected_success_reason',
        'detected_error_reason',
        'screenshot_before',
        'screenshot_after',
        'started_at',
        'finished_at',
        'duration_ms',
    ];

    protected function casts(): array
    {
        return [
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
            'http_status' => 'integer',
            'duration_ms' => 'integer',
        ];
    }

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    public function site(): BelongsTo
    {
        return $this->belongsTo(Site::class);
    }

    public function proxy(): BelongsTo
    {
        return $this->belongsTo(Proxy::class);
    }

    public function botTasks(): HasMany
    {
        return $this->hasMany(BotTask::class);
    }
}
