<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Model;

class FormMapping extends Model
{
    use HasFactory;

    protected $fillable = [
        'site_id',
        'source_url',
        'name_selector',
        'phone_selector',
        'email_selector',
        'message_selector',
        'submit_selector',
        'open_modal_selector',
        'pre_form_click_selectors',
        'pre_form_strategy',
        'quiz_container_selector',
        'form_scope_selector',
        'consent_checkbox_selector',
        'consent_checkbox_selectors',
        'success_selector',
        'error_selector',
        'iframe_selector',
        'captcha_type',
        'captcha_yandex_mode',
        'captcha_iframe_selector',
        'captcha_checkbox_selector',
        'captcha_token_selector',
        'success_text',
        'error_text',
        'wait_after_submit_ms',
        'mapping_type',
        'confidence',
        'screenshot_enabled',
        'screenshot_path',
        'name_coordinates',
        'phone_coordinates',
        'submit_coordinates',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'screenshot_enabled' => 'boolean',
            'name_coordinates' => 'array',
            'phone_coordinates' => 'array',
            'submit_coordinates' => 'array',
            'consent_checkbox_selectors' => 'array',
            'pre_form_click_selectors' => 'array',
            'confidence' => 'decimal:2',
        ];
    }

    public function site(): BelongsTo
    {
        return $this->belongsTo(Site::class);
    }
}
