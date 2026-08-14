<?php

use App\Models\Region;
use App\Models\RegionPhonePrefix;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('region_phone_prefixes', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('region_id')->constrained()->cascadeOnDelete();
            $table->string('from', 32);
            $table->string('to', 32);
            $table->string('operator')->nullable();
            $table->timestamps();

            $table->index(['region_id', 'id']);
        });

        Region::query()->orderBy('id')->chunkById(20, function ($regions): void {
            foreach ($regions as $region) {
                $rows = Region::normalizePhoneGrid($region->getRawOriginal('phone_grid'));
                if ($rows === []) {
                    continue;
                }

                $now = now();
                $payload = [];
                foreach ($rows as $row) {
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

                    if (count($payload) >= 500) {
                        RegionPhonePrefix::query()->insert($payload);
                        $payload = [];
                    }
                }

                if ($payload !== []) {
                    RegionPhonePrefix::query()->insert($payload);
                }

                $region->forceFill(['phone_grid' => null])->saveQuietly();
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('region_phone_prefixes');
    }
};
