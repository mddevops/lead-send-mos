<?php

namespace Tests\Unit;

use App\Models\FormMapping;
use App\Models\Site;
use App\Support\SubmitLeadPayloadBuilder;
use PHPUnit\Framework\TestCase;

class SubmitLeadPayloadBuilderTest extends TestCase
{
    public function test_prefers_source_url_over_ad_url(): void
    {
        $site = new Site([
            'url' => 'https://dealer.example/',
            'ad_url' => 'https://dealer.example/?utm_source=yandex&yclid=1',
        ]);
        $mapping = new FormMapping([
            'source_url' => 'https://dealer.example/used/volvo/s80/845500',
        ]);

        $this->assertSame(
            'https://dealer.example/used/volvo/s80/845500',
            SubmitLeadPayloadBuilder::submitUrl($site, $mapping),
        );
    }

    public function test_strips_tracking_from_source_url(): void
    {
        $site = new Site(['url' => 'https://dealer.example/']);
        $mapping = new FormMapping([
            'source_url' => 'https://dealer.example/credit?utm_campaign=x&keep=1',
        ]);

        $this->assertSame(
            'https://dealer.example/credit?keep=1',
            SubmitLeadPayloadBuilder::submitUrl($site, $mapping),
        );
    }

    public function test_falls_back_to_site_url_when_no_source(): void
    {
        $site = new Site([
            'url' => 'https://dealer.example/contacts',
            'ad_url' => 'https://yabs.yandex.ru/count/xxx',
        ]);
        $mapping = new FormMapping(['source_url' => null]);

        $this->assertSame(
            'https://dealer.example/contacts',
            SubmitLeadPayloadBuilder::submitUrl($site, $mapping),
        );
    }
}
