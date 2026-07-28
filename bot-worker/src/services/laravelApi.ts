import axios from 'axios';
import { config } from '../config';

const http = axios.create({
  baseURL: config.BOT_API_BASE_URL,
  headers: {
    Authorization: `Bearer ${config.BOT_API_TOKEN}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  timeout: 30000,
});

export async function notifyTaskStarted(taskId: number): Promise<void> {
  await http.post(`/bot/tasks/${taskId}/started`, {});
}

export type ClaimedTask = {
  taskId: number;
  type: 'scan_form' | 'submit_lead' | 'manual_mapping_session' | 'discover_yandex_ads';
  payload: Record<string, unknown>;
};

export async function claimNextTask(
  workerId?: string,
  options?: { excludeTypes?: string[] },
): Promise<ClaimedTask | null> {
  const response = await http.post('/bot/tasks/claim', {
    worker_id: workerId ?? null,
    exclude_types: options?.excludeTypes?.length ? options.excludeTypes : undefined,
  });

  const task = (response.data as { task?: ClaimedTask | null }).task;

  return task ?? null;
}

export async function notifyTaskCompleted(taskId: number, payload?: { duration_ms?: number }): Promise<void> {
  await http.post(`/bot/tasks/${taskId}/completed`, payload ?? {});
}

export async function notifyTaskFailed(taskId: number, payload: { error_message: string; duration_ms?: number }): Promise<void> {
  await http.post(`/bot/tasks/${taskId}/failed`, payload);
}

export async function sendSiteMapping(siteId: number, payload: Record<string, unknown>): Promise<void> {
  await http.post(`/bot/sites/${siteId}/mapping`, payload);
}

export async function sendSiteMappingsBulk(
  siteId: number,
  payload: { replace_auto?: boolean; mappings: Record<string, unknown>[] },
): Promise<void> {
  await http.post(`/bot/sites/${siteId}/mappings/bulk`, payload);
}

export async function sendCampaignRunResult(runId: number, payload: Record<string, unknown>): Promise<void> {
  await http.post(`/bot/campaign-runs/${runId}/result`, payload);
}

export async function uploadScreenshot(payload: { run_id?: number; filename?: string; base64: string; disk?: string }): Promise<{ path: string }> {
  const response = await http.post('/bot/screenshots', {
    disk: payload.disk ?? config.BOT_DEFAULT_DISK,
    ...payload,
  });

  return response.data as { path: string };
}

export async function sendDiscoveryRunResult(
  runId: number,
  payload: {
    items: Array<{
      url: string;
      destination_url?: string | null;
      title?: string | null;
      snippet?: string | null;
      yandex_url?: string | null;
    }>;
    pages_scanned?: number;
    blocked?: boolean;
    error_message?: string | null;
  },
): Promise<void> {
  await http.post(`/bot/discovery-runs/${runId}/result`, payload);
}
