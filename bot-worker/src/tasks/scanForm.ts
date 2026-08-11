import pino from 'pino';
import { closeBrowser, openBrowser } from '../playwright/browser';
import { config } from '../config';
import { sendSiteMappingsBulk } from '../services/laravelApi';
import { buildProxyServer, checkIpBeforeRunIfNeeded, ProxyConfig, rotateProxyIfNeeded } from '../services/proxyManager';
import { scanSiteForForms } from '../utils/formScanner';

const logger = pino({ name: 'scan-form' });

type ScanFormPayload = {
  taskId: number;
  siteId: number;
  url: string;
  maxFormMappings?: number;
  healRemap?: boolean;
  excludeFingerprints?: string[];
  proxy?: ProxyConfig | null;
  proxyConfig?: {
    rotate_before_each_site?: boolean;
    check_ip_before_run?: boolean;
    proxy_change_ip_timeout_ms?: number;
  };
};

function formExcludeKey(form: {
  source_url?: string | null;
  open_modal_selector?: string | null;
  form_scope_selector?: string | null;
  phone_selector?: string | null;
  submit_selector?: string | null;
}): string {
  return [
    (form.source_url ?? '').trim().toLowerCase(),
    (form.open_modal_selector ?? '').trim().toLowerCase(),
    (form.form_scope_selector ?? '').trim().toLowerCase(),
    (form.phone_selector ?? '').trim().toLowerCase(),
    (form.submit_selector ?? '').trim().toLowerCase(),
  ].join('|');
}

export async function scanForm(payload: ScanFormPayload): Promise<void> {
  if (!payload.proxy) {
    throw new Error('proxy_required_but_not_available');
  }

  logger.info(
    {
      siteId: payload.siteId,
      url: payload.url,
      headless: config.BOT_HEADLESS,
      pageWaitMs: config.BOT_SCAN_PAGE_WAIT_MS,
      proxy: { id: payload.proxy.id, host: payload.proxy.host, port: payload.proxy.port },
    },
    config.BOT_HEADLESS
      ? 'Starting form scan in headless Chromium'
      : 'Starting form scan — Chromium window should open on this machine',
  );

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
    headless: config.BOT_HEADLESS,
  });
  const page = await session.context.newPage();
  let foundForms = 0;

  try {
    const maxFormMappings = payload.maxFormMappings;
    const exclude = new Set(
      (payload.excludeFingerprints ?? [])
        .map((v) => String(v).trim().toLowerCase())
        .filter(Boolean),
    );

    const { forms: detectedForms, diagnostics } = await scanSiteForForms(page, payload.url, {
      maxForms: maxFormMappings,
      maxPages: payload.healRemap ? 24 : 16,
      discoverModals: true,
      oneMappingPerPage: true,
    });

    let formsToSave = detectedForms;
    if (exclude.size > 0) {
      formsToSave = detectedForms.filter((form) => {
        const key = formExcludeKey(form);
        const hit = exclude.has(key);
        if (hit) {
          logger.info(
            { siteId: payload.siteId, fingerprint: key.slice(0, 160) },
            'Heal remap: skipping previously failing form fingerprint',
          );
        }

        return !hit;
      });
    }

    foundForms = formsToSave.length;

    logger.info(
      {
        siteId: payload.siteId,
        foundForms,
        detectedTotal: detectedForms.length,
        excluded: detectedForms.length - formsToSave.length,
        healRemap: Boolean(payload.healRemap),
        diagnostics,
      },
      'Form scan finished',
    );

    if (formsToSave.length === 0) {
      await sendSiteMappingsBulk(payload.siteId, {
        replace_auto: true,
        mappings: [],
      });

      return;
    }

    await sendSiteMappingsBulk(payload.siteId, {
      replace_auto: true,
      mappings: formsToSave.map((form) => ({
        source_url: form.source_url,
        name_selector: form.name_selector,
        phone_selector: form.phone_selector,
        submit_selector: form.submit_selector,
        consent_checkbox_selector: form.consent_checkbox_selector,
        consent_checkbox_selectors: form.consent_checkbox_selectors,
        form_scope_selector: form.form_scope_selector,
        open_modal_selector: form.open_modal_selector,
        pre_form_click_selectors: form.pre_form_click_selectors ?? null,
        pre_form_strategy: form.pre_form_strategy ?? null,
        quiz_container_selector: form.quiz_container_selector ?? null,
        iframe_selector: form.iframe_selector ?? null,
        captcha_type: form.captcha_type ?? 'none',
        captcha_yandex_mode: form.captcha_yandex_mode ?? null,
        captcha_iframe_selector: form.captcha_iframe_selector ?? null,
        captcha_checkbox_selector: form.captcha_checkbox_selector ?? null,
        captcha_token_selector: form.captcha_token_selector ?? null,
        mapping_type: 'auto',
        confidence: form.confidence,
        status: form.confidence >= 70 ? 'active' : 'draft',
      })),
    });
  } finally {
    const debugPauseMs = config.BOT_DEBUG_PAUSE_MS > 0
      ? config.BOT_DEBUG_PAUSE_MS
      : (!config.BOT_HEADLESS && foundForms === 0 ? 15000 : 0);

    if (debugPauseMs > 0) {
      logger.info(
        { pauseMs: debugPauseMs, foundForms },
        'Debug pause before closing browser — inspect the page in Chromium',
      );
      await page.waitForTimeout(debugPauseMs);
    }

    await closeBrowser(session);
  }
}
