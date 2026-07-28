<?php

namespace App\Support;

use OpenSpout\Reader\XLSX\Reader as XlsxReader;
use RuntimeException;

class PhonePrefixGridBuilder
{
    /** @var list<string> */
    public const MOBILE_OPERATORS = [
        'МТС',
        'МегаФон',
        'Билайн',
        'T2',
        'Теле2',
        'Tele2',
        'Yota',
        'Йота',
        'СберМобайл',
        'Тинькофф Мобайл',
        'Мотив',
        'Ростелеком',
    ];

    /**
     * Excel region label → Region.name in DB.
     *
     * @var array<string, string>
     */
    public const REGION_MAP = [
        'Москва и Московская область' => 'Москва',
        'Санкт-Петербург и Ленинградская область' => 'Санкт-Петербург',
        'Ростовская область' => 'Ростов-на-Дону',
        'Краснодарский край' => 'Краснодар',
        'Республика Карелия' => 'Петрозаводск',
        'Республика Адыгея' => 'Адыгея',
    ];

    /**
     * @return array<string, list<array{from: string, to: string, operator: string}>>
     */
    public function buildFromXlsx(string $path): array
    {
        if (! is_file($path)) {
            throw new RuntimeException("Файл не найден: {$path}");
        }

        $reader = new XlsxReader;
        $reader->open($path);

        $currentOperator = null;
        $currentRegion = null;
        /** @var array<string, list<array{from: string, to: string, operator: string}>> $byRegion */
        $byRegion = [];

        try {
            foreach ($reader->getSheetIterator() as $sheet) {
                foreach ($sheet->getRowIterator() as $rowIndex => $row) {
                    $cells = $row->toArray();
                    $operator = $this->cellString($cells[0] ?? null);
                    $region = $this->cellString($cells[1] ?? null);
                    $code = $this->cellCode($cells[2] ?? null);
                    $prefixes = $this->cellString($cells[3] ?? null);

                    if ($rowIndex === 1 || $operator === 'Оператор' || $region === 'Регион / город') {
                        continue;
                    }

                    if ($operator !== '') {
                        $currentOperator = $operator;
                    }

                    if ($region !== '') {
                        $currentRegion = $region;
                    }

                    if ($code === null || $prefixes === '' || $currentOperator === null || $currentRegion === null) {
                        continue;
                    }

                    if (! $this->isMobileOperator($currentOperator)) {
                        continue;
                    }

                    $mappedRegion = self::REGION_MAP[$currentRegion] ?? null;

                    if ($mappedRegion === null) {
                        continue;
                    }

                    foreach ($this->expandPrefixList($code, $prefixes, $currentOperator) as $range) {
                        $byRegion[$mappedRegion][] = $range;
                    }
                }

                break; // first sheet only
            }
        } finally {
            $reader->close();
        }

        foreach ($byRegion as $regionName => $ranges) {
            $byRegion[$regionName] = $this->dedupeRanges($ranges);
        }

        return $byRegion;
    }

    /**
     * @return list<array{from: string, to: string, operator: string}>
     */
    public function expandPrefixList(string $code, string $prefixes, string $operator): array
    {
        $ranges = [];

        foreach (preg_split('/[,;]+/', $prefixes) ?: [] as $part) {
            $part = trim((string) $part);

            if ($part === '') {
                continue;
            }

            if (str_contains($part, '-')) {
                [$fromPrefix, $toPrefix] = array_map('trim', explode('-', $part, 2));
            } else {
                $fromPrefix = $toPrefix = $part;
            }

            if (! ctype_digit($fromPrefix) || ! ctype_digit($toPrefix)) {
                continue;
            }

            // Keep prefix length as in Excel: 000 / 04900 / 400 …
            $ranges[] = [
                'from' => '+7'.$code.$fromPrefix,
                'to' => '+7'.$code.$toPrefix,
                'operator' => $operator === 'Теле2' || $operator === 'Tele2' ? 'T2' : $operator,
            ];
        }

        return $ranges;
    }

    public function isMobileOperator(string $operator): bool
    {
        foreach (self::MOBILE_OPERATORS as $known) {
            if (mb_strtolower($operator) === mb_strtolower($known)) {
                return true;
            }
        }

        return (bool) preg_match('/мтс|мегафон|билайн|теле.?2|\bt2\b|йота|yota|мотив|сбермобайл|тинькофф/ui', $operator);
    }

    private function cellString(mixed $value): string
    {
        if ($value === null) {
            return '';
        }

        return trim((string) $value);
    }

    private function cellCode(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_int($value) || is_float($value)) {
            return (string) (int) $value;
        }

        $digits = preg_replace('/\D+/', '', (string) $value) ?? '';

        return $digits !== '' ? $digits : null;
    }

    /**
     * @param  list<array{from: string, to: string, operator: string}>  $ranges
     * @return list<array{from: string, to: string, operator: string}>
     */
    private function dedupeRanges(array $ranges): array
    {
        $seen = [];
        $unique = [];

        foreach ($ranges as $range) {
            $key = $range['from'].'|'.$range['to'].'|'.$range['operator'];

            if (isset($seen[$key])) {
                continue;
            }

            $seen[$key] = true;
            $unique[] = $range;
        }

        return $unique;
    }
}
