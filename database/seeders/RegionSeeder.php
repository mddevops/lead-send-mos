<?php

namespace Database\Seeders;

use App\Models\Region;
use Illuminate\Database\Seeder;

class RegionSeeder extends Seeder
{
    public function run(): void
    {
        $regions = [
            [
                'name' => 'Москва',
                'operator' => null,
                'phone_grid' => [
                    ['from' => '+7916', 'to' => '+7917', 'operator' => 'МТС'],
                    ['from' => '+7925', 'to' => '+7926', 'operator' => 'МегаФон'],
                    ['from' => '+7985', 'to' => '+7986', 'operator' => 'МТС'],
                    ['from' => '+7963', 'to' => '+7967', 'operator' => 'Билайн'],
                ],
                'notes' => 'Типичные DEF-коды ЦФО. Учитывайте перенос номеров (MNP).',
            ],
            [
                'name' => 'Санкт-Петербург',
                'operator' => null,
                'phone_grid' => [
                    ['from' => '+7911', 'to' => '+7911', 'operator' => 'МТС'],
                    ['from' => '+7921', 'to' => '+7921', 'operator' => 'МегаФон'],
                    ['from' => '+7931', 'to' => '+7931', 'operator' => 'МегаФон'],
                    ['from' => '+7981', 'to' => '+7981', 'operator' => 'МТС'],
                    ['from' => '+7964', 'to' => '+7967', 'operator' => 'Билайн'],
                ],
                'notes' => 'Северо-Западный федеральный округ.',
            ],
            [
                'name' => 'Ростов-на-Дону',
                'operator' => null,
                'phone_grid' => [
                    ['from' => '+7918', 'to' => '+7919', 'operator' => 'МТС'],
                    ['from' => '+7928', 'to' => '+7928', 'operator' => 'МегаФон'],
                    ['from' => '+7988', 'to' => '+7988', 'operator' => 'МТС'],
                    ['from' => '+7964', 'to' => '+7967', 'operator' => 'Билайн'],
                ],
                'notes' => 'Южный федеральный округ.',
            ],
            [
                'name' => 'Краснодар',
                'operator' => null,
                'phone_grid' => [
                    ['from' => '+7918', 'to' => '+7919', 'operator' => 'МТС'],
                    ['from' => '+7928', 'to' => '+7928', 'operator' => 'МегаФон'],
                    ['from' => '+7978', 'to' => '+7978', 'operator' => 'МТС'],
                    ['from' => '+7964', 'to' => '+7967', 'operator' => 'Билайн'],
                ],
                'notes' => 'Южный федеральный округ, Краснодарский край.',
            ],
            [
                'name' => 'Нижний Новгород',
                'operator' => null,
                'phone_grid' => [
                    ['from' => '+7917', 'to' => '+7917', 'operator' => 'МТС'],
                    ['from' => '+7920', 'to' => '+7920', 'operator' => 'МегаФон'],
                    ['from' => '+7930', 'to' => '+7930', 'operator' => 'МегаФон'],
                    ['from' => '+7987', 'to' => '+7987', 'operator' => 'МТС'],
                    ['from' => '+7964', 'to' => '+7967', 'operator' => 'Билайн'],
                ],
                'notes' => 'Приволжский федеральный округ.',
            ],
            [
                'name' => 'Петрозаводск',
                'operator' => null,
                'phone_grid' => [
                    ['from' => '+7911', 'to' => '+7911', 'operator' => 'МТС'],
                    ['from' => '+7921', 'to' => '+7921', 'operator' => 'МегаФон'],
                    ['from' => '+7931', 'to' => '+7931', 'operator' => 'МегаФон'],
                    ['from' => '+7981', 'to' => '+7981', 'operator' => 'МТС'],
                    ['from' => '+7964', 'to' => '+7967', 'operator' => 'Билайн'],
                ],
                'notes' => 'Республика Карелия, Северо-Западный федеральный округ.',
            ],
            [
                'name' => 'Мурманск',
                'operator' => null,
                'phone_grid' => [
                    ['from' => '+7911', 'to' => '+7911', 'operator' => 'МТС'],
                    ['from' => '+7921', 'to' => '+7921', 'operator' => 'МегаФон'],
                    ['from' => '+7931', 'to' => '+7931', 'operator' => 'МегаФон'],
                    ['from' => '+7981', 'to' => '+7981', 'operator' => 'МТС'],
                    ['from' => '+7964', 'to' => '+7967', 'operator' => 'Билайн'],
                ],
                'notes' => 'Мурманская область, Северо-Западный федеральный округ.',
            ],
        ];

        foreach ($regions as $region) {
            Region::query()->updateOrCreate(
                ['name' => $region['name']],
                [
                    'operator' => $region['operator'],
                    'phone_grid' => $region['phone_grid'],
                    'notes' => $region['notes'],
                ],
            );
        }
    }
}
