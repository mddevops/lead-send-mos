<?php

namespace Tests\Unit;

use App\Services\YandexMapsSiteImporter;
use PHPUnit\Framework\TestCase;

class YandexMapsSiteImporterTest extends TestCase
{
    public function test_it_normalizes_url_to_scheme_and_host_only(): void
    {
        $this->assertSame(
            'https://автолайт-бу.рф',
            YandexMapsSiteImporter::normalizeUrl('https://автолайт-бу.рф/?utm_campaign=site&utm_medium=ri')
        );
    }

    public function test_it_maps_yandex_business_item(): void
    {
        $mapped = YandexMapsSiteImporter::mapItem([
            'shortTitle' => 'АвтоЛайт',
            'fullAddress' => 'Краснодар, улица Александра Покрышкина, 11, стр. 1',
            'status' => 'open',
            'urls' => [
                'https://автолайт-бу.рф/?utm_campaign=site',
            ],
            'phones' => [
                [
                    'number' => '+7 (861) 212-08-58',
                    'value' => '+78612120858',
                ],
            ],
            'ratingData' => [
                'ratingCount' => 61,
                'ratingValue' => 4.900000095367432,
            ],
        ], 1);

        $this->assertSame('АвтоЛайт', $mapped['name']);
        $this->assertSame('https://автолайт-бу.рф', $mapped['url']);
        $this->assertSame('Краснодар, улица Александра Покрышкина, 11, стр. 1', $mapped['address']);
        $this->assertSame('+78612120858', $mapped['phone']);
        $this->assertSame('open', $mapped['business_status']);
        $this->assertSame(61, $mapped['rating_count']);
        $this->assertSame(4.9, $mapped['rating_value']);
        $this->assertSame(1, $mapped['region_id']);
    }

    public function test_it_returns_null_when_urls_are_missing(): void
    {
        $this->assertNull(YandexMapsSiteImporter::mapItem([
            'shortTitle' => 'Без сайта',
        ], 1));
    }

    public function test_it_normalizes_domain_without_www(): void
    {
        $this->assertSame(
            'example.ru',
            YandexMapsSiteImporter::normalizeDomain('https://www.example.ru/page')
        );
        $this->assertSame(
            'example.ru',
            YandexMapsSiteImporter::normalizeDomain('https://example.ru')
        );
    }
}
