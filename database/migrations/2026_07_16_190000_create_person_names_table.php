<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('person_names', function (Blueprint $table): void {
            $table->id();
            $table->string('first_name');
            $table->string('last_name');
            $table->string('gender', 1); // m | f
            $table->timestamps();

            $table->index('gender');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('person_names');
    }
};
