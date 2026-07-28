import pino from 'pino';
import { closeBrowser, openBrowser } from '../playwright/browser';
import { buildProxyServer, checkIpBeforeRunIfNeeded, ProxyConfig, rotateProxyIfNeeded } from '../services/proxyManager';
import { detectSubmitResult } from '../services/resultDetector';
import { captureAndUploadScreenshot } from '../services/screenshotService';
import { sendCampaignRunResult } from '../services/laravelApi';
import {
  clickVisible,
  dismissCommonOverlays,
  ensureActiveLeadFormRoot,
  ensureConsentInForm,
  ensurePhoneFullyFilled,
  fieldLocator,
  fillField,
  humanWarmupScroll,
  openFormModal,
  openFormModalWithFallbacks,
  resolveFormRoot,
  resolveLeadFieldsInRoot,
  resolveModalFormRoot,
  scrollPageToRevealContent,
} from '../utils/formInteractions';
import { observeDomMutations } from '../utils/domMutationWait';
import { SUCCESS_TEXT_PATTERN } from '../utils/formDetectionConstants';
import { pickBrowserFingerprint, RegionPayload } from '../utils/browserProfiles';
import { pickFillBehavior } from '../utils/fillBehaviors';
import { attachFormCaptchaWatcher, resolveCaptcha } from '../utils/captchaHandler';
import { navigateToUrl } from '../utils/navigate';
import { normalizePageUrl } from '../utils/formScanUtils';
import crypto from 'node:crypto';

const logger = pino({ name: 'submit-lead' });

async function safePageContent(page: import('playwright').Page): Promise<string | null> {
  try {
    return await page.content();
  } catch {
    return null;
  }
}

function hashFromContentOrUrl(content: string | null, url: string): string {
  const source = content ?? `no-content:${url}`;
  return crypto.createHash('sha256').update(source).digest('hex');
}

type SubmitLeadPayload = {
  runId: number;
  url: string;
  name: string;
  phone: string;
  region?: RegionPayload;
  mapping: {
    name_selector?: string | null;
    phone_selector: string;
    submit_selector: string;
    open_modal_selector?: string | null;
    form_scope_selector?: string | null;
    consent_checkbox_selector?: string | null;
    consent_checkbox_selectors?: string[] | null;
    iframe_selector?: string | null;
    captcha_type?: string | null;
    captcha_yandex_mode?: string | null;
    captcha_iframe_selector?: string | null;
    captcha_checkbox_selector?: string | null;
    captcha_token_selector?: string | null;
    success_selector?: string | null;
    error_selector?: string | null;
    success_text?: string | null;
    error_text?: string | null;
    wait_after_submit_ms?: number;
  };
  proxy?: ProxyConfig | null;
  proxyConfig?: {
    rotate_before_each_site?: boolean;
    check_ip_before_run?: boolean;
    proxy_change_ip_timeout_ms?: number;
  };
  screenshotConfig?: {
    enabled?: boolean;
    on_success?: boolean;
    on_failed?: boolean;
    on_unknown?: boolean;
    disk?: string;
    fullPage?: boolean;
    quality?: number;
  };
};

export async function submitLead(payload: SubmitLeadPayload): Promise<void> {
  if (!payload.proxy) {
    throw new Error('proxy_required_but_not_available');
  }

  const startedAt = Date.now();
  await rotateProxyIfNeeded({
    proxy: payload.proxy,
    rotateBeforeEachSite: payload.proxyConfig?.rotate_before_each_site,
    timeoutMs: payload.proxyConfig?.proxy_change_ip_timeout_ms,
  });

  await checkIpBeforeRunIfNeeded({
    enabled: payload.proxyConfig?.check_ip_before_run,
    timeoutMs: payload.proxyConfig?.proxy_change_ip_timeout_ms,
  });

  const fingerprint = pickBrowserFingerprint(payload.region ?? null);
  const fillBehavior = pickFillBehavior();

  const session = await openBrowser(buildProxyServer(payload.proxy), {
    fingerprint,
    region: payload.region ?? null,
  });
  const page = await session.context.newPage();

  logger.info(
    {
      url: payload.url,
      region: payload.region ?? null,
      fingerprint: {
        profileId: fingerprint.profileId,
        label: fingerprint.label,
        viewport: fingerprint.viewport,
        timezoneId: fingerprint.timezoneId,
        acceptLanguage: fingerprint.acceptLanguage,
        geolocation: fingerprint.geolocation,
      },
      fillBehavior,
      proxy: payload.proxy
        ? { id: payload.proxy.id, host: payload.proxy.host, port: payload.proxy.port }
        : null,
    },
    'Browser ready, opening site',
  );

  try {
    let responseUrl: string | null = null;
    let responseStatus: number | null = null;
    let responseText: string | null = null;
    const networkOkStatuses: number[] = [];

    page.on('response', async (response) => {
      const request = response.request();
      const method = request.method().toUpperCase();
      const status = response.status();

      if ((method === 'POST' || method === 'PUT' || method === 'PATCH')
        && (status === 200 || status === 201 || status === 204)) {
        networkOkStatuses.push(status);
      }

      if (!request.url().includes(payload.url) && !response.url().includes(new URL(payload.url).hostname)) {
        return;
      }

      responseUrl = response.url();
      responseStatus = status;

      try {
        const text = await response.text();
        responseText = text.slice(0, 4000);
      } catch {
        responseText = null;
      }
    });

    const submitUrl = normalizePageUrl(payload.url);
    logger.info({ url: payload.url, submitUrl }, 'Opening form page for submit');
    await navigateToUrl(page, submitUrl, { timeoutMs: 60000, retries: 1 });
    await dismissCommonOverlays(page);
    // Let dealer SPA finish hydrating card CTAs (credit / callback / trade-in).
    await page.waitForTimeout(1500);
    await humanWarmupScroll(page);

    let formRoot = page.locator('body');

    if (payload.mapping.open_modal_selector) {
      logger.info({ selector: payload.mapping.open_modal_selector }, 'Opening modal form');
      const usedSelector = await openFormModalWithFallbacks(page, payload.mapping.open_modal_selector);
      if (usedSelector !== payload.mapping.open_modal_selector) {
        logger.warn(
          { saved: payload.mapping.open_modal_selector, used: usedSelector },
          'open_modal_selector miss — used CTA fallback',
        );
      }

      // CRITICAL: fill ONLY inside the open modal — never forms on the page behind the overlay.
      formRoot = await resolveModalFormRoot(page, payload.mapping.form_scope_selector);
      logger.info(
        {
          formScope: payload.mapping.form_scope_selector ?? null,
          modalOnly: true,
          openSelector: usedSelector,
        },
        'Using form root inside open modal',
      );
    } else if (payload.mapping.iframe_selector) {
      formRoot = page.locator('body');
    } else if (payload.mapping.form_scope_selector) {
      logger.info({ selector: payload.mapping.form_scope_selector }, 'Using form scope from mapping');
      formRoot = await resolveFormRoot(page, payload.mapping.form_scope_selector);
    } else {
      await humanWarmupScroll(page);
      await scrollPageToRevealContent(page);
      formRoot = await resolveFormRoot(page, null);
    }

    const nameSelector = (payload.mapping.name_selector ?? '').trim();
    const phoneField = fieldLocator(page, payload.mapping, formRoot, payload.mapping.phone_selector);
    const submitButton = fieldLocator(page, payload.mapping, formRoot, payload.mapping.submit_selector);

    const nameFallback = formRoot.locator(
      'input[data-type="NAME"], input.name-input, input[placeholder*="имя" i], input[placeholder*="Имя"]',
    );
    const phoneFallback = formRoot.locator(
      'input[data-type="PHONE"], input.phone-input, input[type="tel"], input[name="tel"], #phone',
    );

    const mappedName = nameSelector
      ? fieldLocator(page, payload.mapping, formRoot, nameSelector)
      : null;
    let nameCount = mappedName ? await mappedName.count() : 0;
    let phoneCount = await phoneField.count();

    const resolvedName = nameCount > 0 && mappedName
      ? mappedName
      : nameFallback;
    const resolvedPhone = phoneCount > 0 ? phoneField : phoneFallback;

    nameCount = await resolvedName.count();
    phoneCount = await resolvedPhone.count();

    // Only treat name as present if mapping asked for it OR a clear name field is visible.
    const shouldFillName = Boolean(nameSelector) || nameCount > 0;

    logger.info(
      {
        name: nameSelector || null,
        phone: payload.mapping.phone_selector,
        submit: payload.mapping.submit_selector,
        counts: {
          name: nameCount,
          phone: phoneCount,
          submit: await submitButton.count(),
          phoneOnly: !shouldFillName || nameCount === 0,
          usedNameFallback: Boolean(nameSelector) && mappedName !== null && (await mappedName.count()) === 0 && nameCount > 0,
          usedPhoneFallback: phoneCount > 0 && (await phoneField.count()) === 0,
        },
      },
      'Filling form fields',
    );

    if (phoneCount === 0) {
      throw new Error(
        'Поле телефона не найдено. Укажите область формы и селектор телефона; для модалок — open_modal_selector.',
      );
    }

    const captchaConfig = {
      captcha_type: payload.mapping.captcha_type,
      captcha_yandex_mode: payload.mapping.captcha_yandex_mode,
      captcha_iframe_selector: payload.mapping.captcha_iframe_selector,
      captcha_checkbox_selector: payload.mapping.captcha_checkbox_selector,
      captcha_token_selector: payload.mapping.captcha_token_selector,
    };

    // Continuous listener: captcha may pop fullscreen or next to the form after phone / submit.
    const captchaWatch = attachFormCaptchaWatcher(page, formRoot, captchaConfig);

    try {
      // Name is optional: many dealer modals are phone-only (Jaecoo etc.).
      if (nameCount > 0 && shouldFillName) {
        const looksLikeName = nameSelector
          || (await resolvedName.first().evaluate((el) => {
            const input = el as HTMLInputElement;
            const blob = [
              input.getAttribute('data-type') || '',
              input.name || '',
              input.placeholder || '',
              input.getAttribute('aria-label') || '',
            ].join(' ');

            return /name|имя|fio|фио/i.test(blob);
          }).catch(() => false));

        if (looksLikeName) {
          await fillField(resolvedName, payload.name, fillBehavior);
          await captchaWatch.drain();
        }
      }

      await fillField(resolvedPhone, payload.phone, fillBehavior);
      // Phone input often triggers SmartCaptcha / reCAPTCHA / hCaptcha.
      await captchaWatch.drain();

      // Promo/action popup may appear while typing — always act inside the topmost lead form.
      let activeRoot = formRoot;
      const retargetAfterPhone = await ensureActiveLeadFormRoot(
        page,
        activeRoot,
        payload.mapping.form_scope_selector,
      );
      activeRoot = retargetAfterPhone.formRoot;

      let activeFields = await resolveLeadFieldsInRoot(page, {
        ...payload.mapping,
        phone_selector: payload.mapping.phone_selector,
        submit_selector: payload.mapping.submit_selector,
        name_selector: payload.mapping.name_selector,
        form_scope_selector: payload.mapping.form_scope_selector,
        iframe_selector: payload.mapping.iframe_selector,
      }, activeRoot);

      if (retargetAfterPhone.switchedToModal) {
        logger.info(
          {
            usedPhoneFallback: activeFields.usedPhoneFallback,
            usedSubmitFallback: activeFields.usedSubmitFallback,
          },
          'Promo/action modal detected during fill — continuing inside that form',
        );

        const nameVisible = (await activeFields.name.count()) > 0
          && (await activeFields.name.filter({ visible: true }).first().isVisible().catch(() => false));

        if (nameVisible && payload.name) {
          await fillField(activeFields.name, payload.name, fillBehavior);
        }

        await fillField(activeFields.phone, payload.phone, fillBehavior);
        await captchaWatch.drain();
      }

      await ensureConsentInForm(
        activeRoot,
        payload.mapping.consent_checkbox_selector,
        payload.mapping.consent_checkbox_selectors,
      );
      await captchaWatch.drain();

      // Re-check again before submit (popup can appear after consent too).
      const retargetBeforeSubmit = await ensureActiveLeadFormRoot(
        page,
        activeRoot,
        payload.mapping.form_scope_selector,
      );
      activeRoot = retargetBeforeSubmit.formRoot;
      activeFields = await resolveLeadFieldsInRoot(page, {
        ...payload.mapping,
        phone_selector: payload.mapping.phone_selector,
        submit_selector: payload.mapping.submit_selector,
        name_selector: payload.mapping.name_selector,
        form_scope_selector: payload.mapping.form_scope_selector,
        iframe_selector: payload.mapping.iframe_selector,
      }, activeRoot);

      if (retargetBeforeSubmit.switchedToModal) {
        logger.info('Foreground modal changed before submit — refilling inside it');
        const nameVisible = (await activeFields.name.count()) > 0
          && (await activeFields.name.filter({ visible: true }).first().isVisible().catch(() => false));
        if (nameVisible && payload.name) {
          await fillField(activeFields.name, payload.name, fillBehavior);
        }
        await fillField(activeFields.phone, payload.phone, fillBehavior);
      }

      // Final guard: mask plugins often drop a digit — never click submit until phone is complete.
      await ensurePhoneFullyFilled(activeFields.phone, payload.phone);
      await captchaWatch.drain();
      await page.waitForTimeout(400);

      const initialUrl = page.url();
      const initialHtml = await safePageContent(page);
      const initialContentHash = hashFromContentOrUrl(initialHtml, initialUrl);

      let screenshotBefore: string | null = null;
      let screenshotAfter: string | null = null;

      const screenshotsEnabled = payload.screenshotConfig?.enabled ?? false;

      if (screenshotsEnabled) {
        screenshotBefore = await captureAndUploadScreenshot({
          page,
          runId: payload.runId,
          filename: `run-${payload.runId}-before.jpg`,
          disk: payload.screenshotConfig?.disk,
          fullPage: payload.screenshotConfig?.fullPage,
          quality: payload.screenshotConfig?.quality,
        });
      }

      logger.info(
        {
          selector: payload.mapping.submit_selector,
          usedSubmitFallback: activeFields.usedSubmitFallback,
        },
        'Submitting form (active/foreground root)',
      );

      const consoleMessages: string[] = [];
      const onConsole = (msg: { text: () => string }): void => {
        const text = msg.text();

        if (text) {
          consoleMessages.push(text);
        }
      };

      page.on('console', onConsole);

      let captchaSolvedAfterSubmit = false;
      let mutationSummary: Awaited<ReturnType<typeof observeDomMutations>> | null = null;

      try {
        await clickVisible(activeFields.submit);

        // Watch DOM mutations right after submit (feeds successScore).
        const mutationPromise = observeDomMutations(page, {
          timeoutMs: 4000,
          successTextPatternSource: SUCCESS_TEXT_PATTERN.toString(),
        });

        await page.waitForLoadState('domcontentloaded').catch(() => undefined);
        await page.waitForTimeout(1500);

        try {
          await captchaWatch.drain();

          // After captcha / another popup — retarget again and submit inside it.
          const retargetAfterCaptcha = await ensureActiveLeadFormRoot(
            page,
            activeRoot,
            payload.mapping.form_scope_selector,
          );
          activeRoot = retargetAfterCaptcha.formRoot;
          activeFields = await resolveLeadFieldsInRoot(page, {
            ...payload.mapping,
            phone_selector: payload.mapping.phone_selector,
            submit_selector: payload.mapping.submit_selector,
            name_selector: payload.mapping.name_selector,
            form_scope_selector: payload.mapping.form_scope_selector,
            iframe_selector: payload.mapping.iframe_selector,
          }, activeRoot);

          const captchaAfterSubmit = await resolveCaptcha(page, activeRoot, captchaConfig, {
            appearTimeoutMs: 5000,
            phase: 'post-submit',
            allowBlindTokenSolve: false,
          });

          if (captchaAfterSubmit || captchaWatch.wasSolved() || retargetAfterCaptcha.switchedToModal) {
            captchaSolvedAfterSubmit = true;
            if (retargetAfterCaptcha.switchedToModal) {
              await ensurePhoneFullyFilled(activeFields.phone, payload.phone).catch(() => undefined);
            }
            logger.info('Captcha/modal after submit — clicking submit inside active form');
            await clickVisible(activeFields.submit).catch(() => undefined);
            await page.waitForLoadState('domcontentloaded').catch(() => undefined);
            await captchaWatch.drain();
            await page.waitForTimeout(2500);
          }
        } catch (captchaError) {
          logger.warn({ err: captchaError }, 'Post-submit captcha handling failed — still detecting result');
        }

        await page.waitForTimeout(payload.mapping.wait_after_submit_ms ?? 3000);
        mutationSummary = await mutationPromise;
      } finally {
        page.off('console', onConsole);
      }

      if (!mutationSummary) {
        mutationSummary = await observeDomMutations(page, {
          timeoutMs: 1500,
          successTextPatternSource: SUCCESS_TEXT_PATTERN.toString(),
        });
      }

      const finalUrl = page.url();
      const finalHtml = await safePageContent(page);
      const finalContentHash = hashFromContentOrUrl(finalHtml, finalUrl);

      const result = await detectSubmitResult({
        page,
        initialUrl,
        finalUrl,
        initialContentHash,
        finalContentHash,
        pageText: finalHtml,
        initialPageText: initialHtml,
        responseStatus,
        networkOkStatuses,
        successSelector: payload.mapping.success_selector,
        errorSelector: payload.mapping.error_selector,
        successText: payload.mapping.success_text,
        errorText: payload.mapping.error_text,
        consoleMessages,
        submitSelector: payload.mapping.submit_selector,
        formScopeSelector: payload.mapping.form_scope_selector,
        nameSelector: payload.mapping.name_selector,
        phoneSelector: payload.mapping.phone_selector,
        captchaSolvedAfterSubmit,
        mutationSummary,
      });

      logger.info(
        {
          status: result.status,
          reason: result.detected_success_reason ?? result.detected_error_reason,
          consoleHits: consoleMessages.filter((line) => /успешн|отправлен/i.test(line)).slice(0, 5),
        },
        'Submit result detected',
      );

      const shouldCaptureAfter =
        screenshotsEnabled &&
        ((result.status === 'success' && (payload.screenshotConfig?.on_success ?? true)) ||
          (result.status === 'failed' && (payload.screenshotConfig?.on_failed ?? true)) ||
          (result.status === 'unknown' && (payload.screenshotConfig?.on_unknown ?? true)));

      if (shouldCaptureAfter) {
        screenshotAfter = await captureAndUploadScreenshot({
          page,
          runId: payload.runId,
          filename: `run-${payload.runId}-after.jpg`,
          disk: payload.screenshotConfig?.disk,
          fullPage: payload.screenshotConfig?.fullPage,
          quality: payload.screenshotConfig?.quality,
        });
      }

      await sendCampaignRunResult(payload.runId, {
        status: result.status,
        detected_success_reason: result.detected_success_reason,
        detected_error_reason: result.detected_error_reason,
        response_url: responseUrl ?? page.url(),
        response_text: responseText,
        http_status: responseStatus,
        screenshot_before: screenshotBefore,
        screenshot_after: screenshotAfter,
        duration_ms: Date.now() - startedAt,
      });
    } finally {
      captchaWatch.stop();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    logger.error({ err: error }, 'submit_lead failed');

    await sendCampaignRunResult(payload.runId, {
      status: 'failed',
      error_message: message,
      duration_ms: Date.now() - startedAt,
    });
  } finally {
    await closeBrowser(session);
  }
}
