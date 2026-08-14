<?php

namespace App\Console\Commands;

use App\Models\Region;
use App\Models\RegionPhonePrefix;
use App\Support\PhonePrefixGridBuilder;
use Illuminate\Console\Command;

class ImportRegionPhonePrefixes extends Command
{
    protected $signature = 'regions:import-prefixes
                            {file? : Путь к xlsx (по умолчанию public/files/prefixes.xlsx)}
                            {--dry-run : Только показать статистику, не писать в БД}';

    protected $description = 'Обновить phone_grid регионов из Excel с сотовыми префиксами';

    public function handle(PhonePrefixGridBuilder $builder): int
    {
        $file = $this->argument('file') ?: public_path('files/prefixes.xlsx');

        $this->info("Читаю: {$file}");

        $grids = $builder->buildFromXlsx($file);

        if ($grids === []) {
            $this->error('Не удалось разобрать ни одного диапазона.');

            return self::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');

        foreach ($grids as $regionName => $ranges) {
            $operators = collect($ranges)->pluck('operator')->unique()->sort()->values()->all();
            $this->line(sprintf(
                '• %s — %d диапазонов [%s]',
                $regionName,
                count($ranges),
                implode(', ', $operators),
            ));

            if ($dryRun) {
                continue;
            }

            Region::query()->updateOrCreate(
                ['name' => $regionName],
                [
                    'operator' => null,
                    'phone_grid' => null,
                    'notes' => 'Импорт сотовых префиксов из prefixes.xlsx',
                ],
            );

            $region = Region::query()->where('name', $regionName)->first();
            if ($region === null) {
                continue;
            }

            $region->phonePrefixes()->delete();

            $now = now();
            foreach (array_chunk($ranges, 500) as $chunk) {
                $payload = [];
                foreach ($chunk as $row) {
                    $from = trim((string) ($row['from'] ?? ''));
                    $to = trim((string) ($row['to'] ?? ''));
                    if ($from === '' || $to === '') {
                        continue;
                    }

                    $payload[] = [
                        'region_id' => $region->id,
                        'from' => $from,
                        'to' => $to,
                        'operator' => isset($row['operator']) && is_string($row['operator']) && $row['operator'] !== ''
                            ? $row['operator']
                            : null,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];
                }

                if ($payload !== []) {
                    RegionPhonePrefix::query()->insert($payload);
                }
            }
        }

        if ($dryRun) {
            $this->warn('Dry-run: БД не изменена.');
        } else {
            $this->info('Готово: phone_grid обновлён для '.count($grids).' регионов.');
        }

        return self::SUCCESS;
    }
}
