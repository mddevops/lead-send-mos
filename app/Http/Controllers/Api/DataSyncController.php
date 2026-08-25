<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DailyPipelineRun;
use App\Services\DataSyncService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DataSyncController extends Controller
{
    public function __construct(
        private readonly DataSyncService $sync,
    ) {}

    public function exportSites(Request $request): JsonResponse
    {
        $ids = $request->query('ids');
        $siteIds = null;
        if (is_string($ids) && trim($ids) !== '') {
            $siteIds = array_values(array_filter(array_map('intval', explode(',', $ids))));
        } elseif (is_array($ids)) {
            $siteIds = array_values(array_filter(array_map('intval', $ids)));
        }

        return response()->json($this->sync->exportSites($siteIds));
    }

    public function importSites(Request $request): JsonResponse
    {
        $data = $request->validate([
            'version' => ['nullable', 'integer'],
            'type' => ['nullable', 'string'],
            'sites' => ['required', 'array', 'min:1'],
            'replace_mappings' => ['nullable', 'boolean'],
        ]);

        $result = $this->sync->importSites(
            $data,
            (bool) ($data['replace_mappings'] ?? true),
        );

        $ok = $result['errors'] === []
            || ($result['created_sites'] + $result['updated_sites']) > 0;

        return response()->json(['ok' => $ok, ...$result], $ok ? 200 : 422);
    }

    public function exportProxies(): JsonResponse
    {
        return response()->json($this->sync->exportProxies());
    }

    public function importProxies(Request $request): JsonResponse
    {
        $data = $request->validate([
            'version' => ['nullable', 'integer'],
            'type' => ['nullable', 'string'],
            'proxies' => ['required', 'array', 'min:1'],
        ]);

        $result = $this->sync->importProxies($data);
        $ok = $result['errors'] === [] || ($result['created'] + $result['updated']) > 0;

        return response()->json(['ok' => $ok, ...$result], $ok ? 200 : 422);
    }

    public function exportRegions(Request $request): JsonResponse
    {
        $ids = $request->query('ids');
        $regionIds = null;
        if (is_string($ids) && trim($ids) !== '') {
            $regionIds = array_values(array_filter(array_map('intval', explode(',', $ids))));
        } elseif (is_array($ids)) {
            $regionIds = array_values(array_filter(array_map('intval', $ids)));
        }

        return response()->json($this->sync->exportRegions($regionIds));
    }

    public function importRegions(Request $request): JsonResponse
    {
        $data = $request->validate([
            'version' => ['nullable', 'integer'],
            'type' => ['nullable', 'string'],
            'regions' => ['required', 'array', 'min:1'],
            'replace_prefixes' => ['nullable', 'boolean'],
        ]);

        $result = $this->sync->importRegions(
            $data,
            (bool) ($data['replace_prefixes'] ?? true),
        );

        $ok = $result['errors'] === []
            || ($result['created'] + $result['updated']) > 0;

        return response()->json(['ok' => $ok, ...$result], $ok ? 200 : 422);
    }

    public function exportPipelines(Request $request): JsonResponse
    {
        $ids = $request->query('ids');
        $pipelineIds = null;
        if (is_string($ids) && trim($ids) !== '') {
            $pipelineIds = array_values(array_filter(array_map('intval', explode(',', $ids))));
        }

        return response()->json($this->sync->exportPipelines($pipelineIds));
    }

    public function exportPipeline(DailyPipelineRun $pipeline): JsonResponse
    {
        return response()->json($this->sync->exportPipeline($pipeline));
    }

    public function importPipelines(Request $request): JsonResponse
    {
        $data = $request->validate([
            'version' => ['nullable', 'integer'],
            'type' => ['nullable', 'string'],
            'pipeline' => ['nullable', 'array'],
            'pipelines' => ['nullable', 'array'],
            'sites' => ['nullable', 'array'],
            'replace_mappings' => ['nullable', 'boolean'],
        ]);

        if (! isset($data['pipeline']) && ! isset($data['pipelines'])) {
            return response()->json([
                'ok' => false,
                'message' => 'pipeline or pipelines is required',
            ], 422);
        }

        $result = $this->sync->importPipeline(
            $data,
            (bool) ($data['replace_mappings'] ?? true),
        );

        $ok = $result['errors'] === [] || ($result['created_pipelines'] ?? 0) > 0;

        return response()->json(['ok' => $ok, ...$result], $ok ? 200 : 422);
    }
}
