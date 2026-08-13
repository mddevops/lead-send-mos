<?php

namespace App\Models;

use App\Support\ParentDomain;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Site extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
        'region_id',
        'url',
        'parent_domain',
        'ad_url',
        'address',
        'phone',
        'business_status',
        'rating_count',
        'rating_value',
        'status',
        'source',
        'is_promo',
        'notes',
        'submit_fail_streak',
        'submit_heal_status',
        'submit_heal_meta',
        'last_scan_at',
        'discovered_at',
        'discovery_run_id',
    ];

    protected function casts(): array
    {
        return [
            'last_scan_at' => 'datetime',
            'discovered_at' => 'datetime',
            'rating_count' => 'integer',
            'rating_value' => 'float',
            'is_promo' => 'boolean',
            'submit_fail_streak' => 'integer',
            'submit_heal_meta' => 'array',
        ];
    }

    protected static function booted(): void
    {
        static::saving(function (Site $site): void {
            if ($site->isDirty('url') || blank($site->parent_domain)) {
                $site->parent_domain = ParentDomain::fromUrl($site->url);
            }
        });
    }

    public function formMappings(): HasMany
    {
        return $this->hasMany(FormMapping::class);
    }

    public function campaignSiteRuns(): HasMany
    {
        return $this->hasMany(CampaignSiteRun::class);
    }

    public function region(): BelongsTo
    {
        return $this->belongsTo(Region::class);
    }

    public function discoveryRun(): BelongsTo
    {
        return $this->belongsTo(DiscoveryRun::class);
    }

    protected function url(): Attribute
    {
        return Attribute::make(
            set: static fn (string $value): string => trim($value),
        );
    }
}
