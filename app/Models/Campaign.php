<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Model;

class Campaign extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
        'phone',
        'source',
        'status',
        'total_sites',
        'success_count',
        'failed_count',
        'skipped_count',
        'unknown_count',
        'started_at',
        'finished_at',
        'created_by',
        'telegram_chat_id',
        'telegram_status_notified_at',
    ];

    protected function casts(): array
    {
        return [
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
            'telegram_status_notified_at' => 'datetime',
        ];
    }

    public function runs(): HasMany
    {
        return $this->hasMany(CampaignSiteRun::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
