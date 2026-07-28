<?php

namespace Tests\Unit;

use App\Support\CssSelectorBuilder;
use PHPUnit\Framework\TestCase;

class CssSelectorBuilderTest extends TestCase
{
    public function test_it_builds_selector_by_id(): void
    {
        $this->assertSame('#lead-name', CssSelectorBuilder::build([
            'tag' => 'input',
            'id' => 'lead-name',
            'class' => 'form-control',
        ]));
    }

    public function test_it_builds_selector_by_tag_and_classes(): void
    {
        $this->assertSame('input.form-control.phone', CssSelectorBuilder::build([
            'tag' => 'input',
            'id' => null,
            'class' => 'form-control phone',
        ]));
    }

    public function test_it_scopes_selector_with_container(): void
    {
        $this->assertSame(
            '#modal-form input.phone',
            CssSelectorBuilder::scoped('#modal-form', 'input.phone'),
        );
    }

    public function test_it_appends_name_attribute_when_provided(): void
    {
        $this->assertSame('input.field[name="phone"]', CssSelectorBuilder::build([
            'tag' => 'input',
            'id' => null,
            'class' => 'field',
            'name' => 'phone',
        ]));
    }

    public function test_it_appends_type_attribute_when_provided(): void
    {
        $this->assertSame('button.btn[type="submit"]', CssSelectorBuilder::build([
            'tag' => 'button',
            'id' => null,
            'class' => 'btn',
            'type' => 'submit',
        ]));
    }
}
