<?php

namespace App\Support;

use App\Models\Site;
use Illuminate\Support\Collection;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Writer\XLSX\Writer;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

final class SitesExcelExport
{
    /**
     * @param  Collection<int, Site>  $sites
     */
    public static function downloadXlsx(Collection $sites, string $filenamePrefix = 'sites'): BinaryFileResponse
    {
        $filename = $filenamePrefix.'-'.now()->format('Y-m-d-His').'.xlsx';
        $tmpPath = tempnam(sys_get_temp_dir(), 'sites-xlsx-');

        if ($tmpPath === false) {
            throw new \RuntimeException('Не удалось создать временный файл для Excel.');
        }

        // OpenSpout пишет zip-архив — нужен обычный файл, не php://output.
        $xlsxPath = $tmpPath.'.xlsx';
        @unlink($tmpPath);

        $writer = new Writer();
        $writer->openToFile($xlsxPath);
        $writer->addRow(Row::fromValues(['URL', 'Промо', 'Регион']));

        foreach ($sites as $site) {
            $writer->addRow(Row::fromValues([
                (string) $site->url,
                $site->is_promo ? 'Да' : 'Нет',
                (string) ($site->region?->name ?? ''),
            ]));
        }

        $writer->close();

        return response()
            ->download($xlsxPath, $filename, [
                'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            ])
            ->deleteFileAfterSend(true);
    }
}
