<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class DiscoveryRun extends Model
{
    protected $fillable = [
        'region_id',
        'bot_task_id',
        'query',
        'run_date',
        'status',
        'pages_scanned',
        'found_count',
        'new_sites_count',
        'skipped_existing_count',
        'skipped_excluded_count',
        'blocked',
        'found_items',
        'error_message',
        'started_at',
        'finished_at',
    ];

    protected function casts(): array
    {
        return [
            'run_date' => 'date',
            'found_items' => 'array',
            'blocked' => 'boolean',
            'pages_scanned' => 'integer',
            'found_count' => 'integer',
            'new_sites_count' => 'integer',
            'skipped_existing_count' => 'integer',
            'skipped_excluded_count' => 'integer',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
        ];
    }

    public function region(): BelongsTo
    {
        return $this->belongsTo(Region::class);
    }

    public function botTask(): BelongsTo
    {
        return $this->belongsTo(BotTask::class);
    }

    public function sites(): HasMany
    {
        return $this->hasMany(Site::class);
    }
}
