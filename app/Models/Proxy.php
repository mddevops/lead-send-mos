<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Crypt;

class Proxy extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
        'provider',
        'type',
        'host',
        'port',
        'username',
        'password',
        'change_ip_url',
        'status',
        'last_used_at',
        'cooldown_until',
        'last_ip',
        'notes',
    ];

    protected $hidden = [
        'password',
    ];

    protected function casts(): array
    {
        return [
            'last_used_at' => 'datetime',
            'cooldown_until' => 'datetime',
        ];
    }

    public function campaignSiteRuns(): HasMany
    {
        return $this->hasMany(CampaignSiteRun::class);
    }

    public function setPasswordAttribute(?string $value): void
    {
        $this->attributes['password'] = filled($value) ? Crypt::encryptString($value) : null;
    }

    public function getPasswordAttribute(?string $value): ?string
    {
        if (blank($value)) {
            return null;
        }

        return Crypt::decryptString($value);
    }
}
