<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Model;

class BotTask extends Model
{
    use HasFactory;

    protected $fillable = [
        'type',
        'status',
        'site_id',
        'campaign_site_run_id',
        'payload',
        'error_message',
        'started_at',
        'finished_at',
        'duration_ms',
    ];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
            'duration_ms' => 'integer',
        ];
    }

    public function site(): BelongsTo
    {
        return $this->belongsTo(Site::class);
    }

    public function campaignSiteRun(): BelongsTo
    {
        return $this->belongsTo(CampaignSiteRun::class);
    }
}
