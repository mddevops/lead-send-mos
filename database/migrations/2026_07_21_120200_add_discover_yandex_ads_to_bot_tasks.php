<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE bot_tasks MODIFY COLUMN type ENUM('scan_form', 'submit_lead', 'manual_mapping_session', 'discover_yandex_ads') NOT NULL");
    }

    public function down(): void
    {
        DB::statement("ALTER TABLE bot_tasks MODIFY COLUMN type ENUM('scan_form', 'submit_lead', 'manual_mapping_session') NOT NULL");
    }
};
