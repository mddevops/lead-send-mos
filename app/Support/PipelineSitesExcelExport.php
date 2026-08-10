<?php

namespace App\Support;

use OpenSpout\Common\Entity\Row;
use OpenSpout\Common\Entity\Style\Border;
use OpenSpout\Common\Entity\Style\BorderPart;
use OpenSpout\Common\Entity\Style\Color;
use OpenSpout\Common\Entity\Style\Style;
use OpenSpout\Writer\XLSX\Writer;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

final class PipelineSitesExcelExport
{
    /**
     * @param  list<array{name: string, total: int, failed: int}>  $rows
     */
    public static function downloadXlsx(
        array $rows,
        string $regionName,
        ?string $submitStartedAt = null,
        ?string $submitFinishedAt = null,
    ): BinaryFileResponse {
        $safeRegion = self::sanitizeFilename($regionName !== '' ? $regionName : 'region');
        $filename = $safeRegion.'-'.now()->format('Y-m-d').'.xlsx';

        $tmpPath = tempnam(sys_get_temp_dir(), 'pipeline-sites-xlsx-');
        if ($tmpPath === false) {
            throw new \RuntimeException('Не удалось создать временный файл для Excel.');
        }

        $xlsxPath = $tmpPath.'.xlsx';
        @unlink($tmpPath);

        $border = new Border(
            new BorderPart(Border::LEFT, Color::BLACK, Border::WIDTH_THIN, Border::STYLE_SOLID),
            new BorderPart(Border::RIGHT, Color::BLACK, Border::WIDTH_THIN, Border::STYLE_SOLID),
            new BorderPart(Border::TOP, Color::BLACK, Border::WIDTH_THIN, Border::STYLE_SOLID),
            new BorderPart(Border::BOTTOM, Color::BLACK, Border::WIDTH_THIN, Border::STYLE_SOLID),
        );

        $headerStyle = (new Style())
            ->setFontBold()
            ->setFontSize(12)
            ->setFontName('Calibri')
            ->setBorder($border);

        $dataStyle = (new Style())
            ->setFontSize(11)
            ->setFontName('Calibri')
            ->setBorder($border);

        $totalStyle = (new Style())
            ->setFontBold()
            ->setFontSize(12)
            ->setFontName('Calibri')
            ->setBorder($border);

        $metaLabelStyle = (new Style())
            ->setFontBold()
            ->setFontSize(12)
            ->setFontName('Calibri')
            ->setBorder($border);

        $metaValueStyle = (new Style())
            ->setFontSize(12)
            ->setFontName('Calibri')
            ->setBorder($border);

        $writer = new Writer();
        $writer->openToFile($xlsxPath);

        $sheet = $writer->getCurrentSheet();
        $sheet->setColumnWidth(35.5, 1);
        $sheet->setColumnWidth(14.7, 2);
        $sheet->setColumnWidth(12.0, 3);

        $writer->addRow(Row::fromValues(
            ['Название сайта', 'Отправлено', 'Ошибки'],
            $headerStyle,
        ));

        $sumTotal = 0;
        $sumFailed = 0;

        foreach ($rows as $row) {
            $total = (int) ($row['total'] ?? 0);
            $failed = (int) ($row['failed'] ?? 0);
            $sumTotal += $total;
            $sumFailed += $failed;

            $writer->addRow(Row::fromValues([
                (string) ($row['name'] ?? ''),
                $total,
                $failed,
            ], $dataStyle));
        }

        $writer->addRow(Row::fromValues([
            'Итог',
            $sumTotal,
            $sumFailed,
        ], $totalStyle));

        $writer->addRow(Row::fromValuesWithStyles(
            [
                'Дата начала отправки формы',
                $submitStartedAt ?: '—',
            ],
            null,
            [0 => $metaLabelStyle, 1 => $metaValueStyle],
        ));

        $writer->addRow(Row::fromValuesWithStyles(
            [
                'Дата окончании отправки формы',
                $submitFinishedAt ?: '—',
            ],
            null,
            [0 => $metaLabelStyle, 1 => $metaValueStyle],
        ));

        $writer->close();

        return response()
            ->download($xlsxPath, $filename, [
                'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            ])
            ->deleteFileAfterSend(true);
    }

    private static function sanitizeFilename(string $value): string
    {
        $value = trim($value);
        $value = preg_replace('/[\\\\\/:\*\?"<>\|]+/u', '-', $value) ?? $value;
        $value = preg_replace('/\s+/u', ' ', $value) ?? $value;
        $value = trim($value, " .-_\t\n\r");

        return $value !== '' ? $value : 'region';
    }
}
