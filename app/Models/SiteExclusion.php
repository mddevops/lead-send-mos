<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SiteExclusion extends Model
{
    protected $fillable = [
        'domain',
        'note',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
        ];
    }

    public static function normalizeDomain(string $value): string
    {
        $value = trim(mb_strtolower($value));
        $value = preg_replace('#^https?://#i', '', $value) ?? $value;
        $value = explode('/', $value)[0] ?? $value;
        $value = explode('?', $value)[0] ?? $value;

        if (str_starts_with($value, 'www.')) {
            $value = substr($value, 4);
        }

        return $value;
    }
}
