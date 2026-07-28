<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class PersonName extends Model
{
    use HasFactory;

    public const GENDER_MALE = 'm';

    public const GENDER_FEMALE = 'f';

    protected $fillable = [
        'first_name',
        'middle_name',
        'last_name',
        'gender',
    ];

    public function fullName(): string
    {
        return trim(implode(' ', array_filter([
            $this->first_name,
            $this->middle_name,
            $this->last_name,
        ], fn (?string $part): bool => is_string($part) && $part !== '')));
    }

    public function genderLabel(): string
    {
        return $this->gender === self::GENDER_MALE ? 'М' : 'Ж';
    }

    public function scopeOfGender($query, string $gender)
    {
        return $query->where('gender', $gender);
    }
}
