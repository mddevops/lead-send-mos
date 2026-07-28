<?php

namespace App\Services;

use App\Models\PersonName;
use App\Models\Region;
use App\Models\Site;
use RuntimeException;

class LeadIdentityGenerator
{
    /**
     * @return array{name: string, phone: string, gender: string, first_name: string, middle_name: string, last_name: string, region: ?string, operator: ?string}
     */
    public function generateForSite(Site $site): array
    {
        $site->loadMissing('region');

        $gender = random_int(0, 1) === 0 ? PersonName::GENDER_MALE : PersonName::GENDER_FEMALE;
        [$firstName, $middleName, $lastName] = $this->pickNameParts($gender);
        $phoneMeta = $this->generatePhoneForRegion($site->region);

        // Иногда ФИО с отчеством, иногда только имя + фамилия.
        $includeMiddleName = random_int(0, 1) === 1;
        $usedMiddleName = $includeMiddleName ? $middleName : '';
        $name = $includeMiddleName
            ? trim("{$firstName} {$middleName} {$lastName}")
            : trim("{$firstName} {$lastName}");

        return [
            'name' => $name,
            'first_name' => $firstName,
            'middle_name' => $usedMiddleName,
            'last_name' => $lastName,
            'gender' => $gender === PersonName::GENDER_MALE ? 'М' : 'Ж',
            'phone' => $phoneMeta['phone'],
            'region' => $site->region?->name,
            'operator' => $phoneMeta['operator'],
        ];
    }

    /**
     * @return array{0: string, 1: string, 2: string}
     */
    public function pickNameParts(string $gender): array
    {
        $base = PersonName::query()->ofGender($gender);

        if (! $base->exists()) {
            $base = PersonName::query();
        }

        if (! PersonName::query()->exists()) {
            throw new RuntimeException('Таблица person_names пуста. Выполните: php artisan db:seed --class=PersonNameSeeder');
        }

        $firstName = (clone $base)->inRandomOrder()->value('first_name');
        $middleName = (clone $base)->whereNotNull('middle_name')->where('middle_name', '!=', '')->inRandomOrder()->value('middle_name');
        $lastName = (clone $base)->inRandomOrder()->value('last_name');

        if (! is_string($firstName) || ! is_string($lastName) || $firstName === '' || $lastName === '') {
            throw new RuntimeException('Не удалось выбрать имя/фамилию из person_names.');
        }

        if (! is_string($middleName) || $middleName === '') {
            throw new RuntimeException('Не удалось выбрать отчество из person_names.');
        }

        return [$firstName, $middleName, $lastName];
    }

    /**
     * @return array{phone: string, operator: ?string}
     */
    public function generatePhoneForRegion(?Region $region): array
    {
        $grid = $region?->phone_grid ?? [];

        if ($grid === []) {
            throw new RuntimeException(
                $region
                    ? "У региона «{$region->name}» нет phone_grid."
                    : 'У сайта не указан регион — нельзя сгенерировать номер из сетки.'
            );
        }

        $row = $grid[array_rand($grid)];
        if (! is_array($row)) {
            throw new RuntimeException('Некорректная запись phone_grid.');
        }

        return [
            'phone' => $this->randomPhoneFromRange(
                (string) ($row['from'] ?? ''),
                (string) ($row['to'] ?? ''),
            ),
            'operator' => isset($row['operator']) && is_string($row['operator']) && $row['operator'] !== ''
                ? $row['operator']
                : ($region?->operator),
        ];
    }

    /**
     * Генерирует 10-значный номер (без +7) в диапазоне DEF-префиксов.
     * Пример: from=+7916, to=+7917 → 9168541916
     */
    public function randomPhoneFromRange(string $from, string $to): string
    {
        $fromDigits = preg_replace('/\D+/', '', $from) ?? '';
        $toDigits = preg_replace('/\D+/', '', $to) ?? '';

        if ($fromDigits === '' || $toDigits === '') {
            throw new RuntimeException('В phone_grid пустые from/to.');
        }

        $fromBound = $this->expandPrefixBound($fromDigits, '0');
        $toBound = $this->expandPrefixBound($toDigits, '9');

        if ($fromBound > $toBound) {
            [$fromBound, $toBound] = [$toBound, $fromBound];
        }

        $number = (string) random_int((int) $fromBound, (int) $toBound);

        if (strlen($number) === 11 && str_starts_with($number, '7')) {
            return substr($number, 1);
        }

        return $number;
    }

    private function expandPrefixBound(string $digits, string $padChar): string
    {
        // 916 → 7916
        if (strlen($digits) === 3) {
            $digits = '7'.$digits;
        }

        if (strlen($digits) < 11) {
            $digits = str_pad($digits, 11, $padChar);
        }

        if (strlen($digits) > 11) {
            $digits = substr($digits, 0, 11);
        }

        return $digits;
    }
}
