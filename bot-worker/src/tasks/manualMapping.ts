import { closeBrowser, openBrowser } from '../playwright/browser';
import { buildProxyServer, checkIpBeforeRunIfNeeded, ProxyConfig, rotateProxyIfNeeded } from '../services/proxyManager';
import { captureAndUploadScreenshot } from '../services/screenshotService';
import { sendSiteMapping } from '../services/laravelApi';
import { navigateToUrl } from '../utils/navigate';

type ManualMappingPayload = {
  taskId: number;
  siteId: number;
  url: string;
  headless?: boolean;
  holdSecondsMs?: number;
  selectors?: {
    name_selector?: string | null;
    phone_selector?: string | null;
    submit_selector?: string | null;
    open_modal_selector?: string | null;
    consent_checkbox_selector?: string | null;
    success_selector?: string | null;
    error_selector?: string | null;
  };
  proxy?: ProxyConfig | null;
  proxyConfig?: {
    rotate_before_each_site?: boolean;
    check_ip_before_run?: boolean;
    proxy_change_ip_timeout_ms?: number;
  };
  screenshotConfig?: {
    enabled?: boolean;
    disk?: string;
    fullPage?: boolean;
    quality?: number;
  };
};

export async function manualMappingSession(payload: ManualMappingPayload): Promise<void> {
  await rotateProxyIfNeeded({
    proxy: payload.proxy,
    rotateBeforeEachSite: payload.proxyConfig?.rotate_before_each_site,
    timeoutMs: payload.proxyConfig?.proxy_change_ip_timeout_ms,
  });

  await checkIpBeforeRunIfNeeded({
    enabled: payload.proxyConfig?.check_ip_before_run,
    timeoutMs: payload.proxyConfig?.proxy_change_ip_timeout_ms,
  });

  const session = await openBrowser(buildProxyServer(payload.proxy), {
    headless: payload.headless ?? false,
  });
  const page = await session.context.newPage();

  try {
    await navigateToUrl(page, payload.url, { timeoutMs: 60000, retries: 1 });

    if (payload.screenshotConfig?.enabled) {
      const path = await captureAndUploadScreenshot({
        page,
        filename: `manual-mapping-site-${payload.siteId}.jpg`,
        disk: payload.screenshotConfig.disk,
        fullPage: payload.screenshotConfig.fullPage,
        quality: payload.screenshotConfig.quality,
      });

      await sendSiteMapping(payload.siteId, {
        screenshot_path: path,
        mapping_type: 'manual',
        status: 'draft',
        name_selector: payload.selectors?.name_selector ?? 'input[name="name"]',
        phone_selector: payload.selectors?.phone_selector ?? 'input[name="phone"]',
        submit_selector: payload.selectors?.submit_selector ?? 'button[type="submit"]',
        open_modal_selector: payload.selectors?.open_modal_selector,
        consent_checkbox_selector: payload.selectors?.consent_checkbox_selector,
        success_selector: payload.selectors?.success_selector,
        error_selector: payload.selectors?.error_selector,
        confidence: 0,
      });
    }

    const selectors = payload.selectors;
    const hasRequired =
      selectors?.name_selector && selectors?.phone_selector && selectors?.submit_selector;

    if (hasRequired) {
      const checks = await Promise.all([
        page.locator(selectors.name_selector!).count(),
        page.locator(selectors.phone_selector!).count(),
        page.locator(selectors.submit_selector!).count(),
      ]);

      if (checks.every((count) => count > 0)) {
        await sendSiteMapping(payload.siteId, {
          name_selector: selectors.name_selector,
          phone_selector: selectors.phone_selector,
          submit_selector: selectors.submit_selector,
          open_modal_selector: selectors.open_modal_selector ?? null,
          consent_checkbox_selector: selectors.consent_checkbox_selector ?? null,
          success_selector: selectors.success_selector ?? null,
          error_selector: selectors.error_selector ?? null,
          mapping_type: 'manual',
          confidence: 100,
          status: 'active',
        });
      }
    }

    await page.waitForTimeout(payload.holdSecondsMs ?? 120_000);
  } finally {
    await closeBrowser(session);
  }
}
