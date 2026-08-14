<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Region extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
        'operator',
        'phone_grid',
        'notes',
    ];

    protected function phoneGrid(): Attribute
    {
        return Attribute::make(
            get: fn (mixed $value): array => self::normalizePhoneGrid($value),
            set: function (mixed $value): ?string {
                $normalized = self::normalizePhoneGrid($value);

                return $normalized === []
                    ? null
                    : json_encode($normalized, JSON_UNESCAPED_UNICODE);
            },
        );
    }

    /**
     * @return list<array{from?: string, to?: string, operator?: string}>
     */
    public static function normalizePhoneGrid(mixed $value): array
    {
        if (is_string($value)) {
            $value = json_decode($value, true);
        }

        if (! is_array($value) || $value === []) {
            return [];
        }

        if (array_key_exists('from', $value) || array_key_exists('to', $value)) {
            return [$value];
        }

        return array_values(array_filter($value, fn (mixed $row): bool => is_array($row)));
    }

    public function formatPhoneGridPreview(int $limit = 2): string
    {
        $rows = $this->exists
            ? $this->phonePrefixes()->limit($limit)->get(['from', 'to'])
            : collect(self::normalizePhoneGrid($this->getAttributes()['phone_grid'] ?? null));

        $preview = collect($rows)
            ->map(function ($row): ?string {
                $from = is_array($row) ? ($row['from'] ?? '') : $row->from;
                $to = is_array($row) ? ($row['to'] ?? '') : $row->to;

                if ($from === '' && $to === '') {
                    return null;
                }

                return trim($from.' → '.$to);
            })
            ->filter();

        return $preview->isEmpty() ? '—' : $preview->implode('; ');
    }

    public function phonePrefixes(): HasMany
    {
        return $this->hasMany(RegionPhonePrefix::class);
    }

    public function sites(): HasMany
    {
        return $this->hasMany(Site::class);
    }

    /**
     * @return list<array{from: string, to: string, operator?: string|null}>
     */
    public function syncPhonePrefixesFromGrid(array $grid): void
    {
        $rows = self::normalizePhoneGrid($grid);
        $this->phonePrefixes()->delete();

        $payload = [];
        foreach ($rows as $row) {
            $from = trim((string) ($row['from'] ?? ''));
            $to = trim((string) ($row['to'] ?? ''));
            if ($from === '' || $to === '') {
                continue;
            }

            $payload[] = [
                'from' => $from,
                'to' => $to,
                'operator' => isset($row['operator']) && is_string($row['operator']) && $row['operator'] !== ''
                    ? $row['operator']
                    : null,
            ];
        }

        if ($payload !== []) {
            $this->phonePrefixes()->createMany($payload);
        }
    }
}
