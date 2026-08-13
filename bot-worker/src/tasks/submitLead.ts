import pino from 'pino';
import { closeBrowser, openBrowser } from '../playwright/browser';
import { buildProxyServer, checkIpBeforeRunIfNeeded, ProxyConfig, rotateProxyIfNeeded } from '../services/proxyManager';
import { detectSubmitResult } from '../services/resultDetector';
import { captureAndUploadScreenshot } from '../services/screenshotService';
import { sendCampaignRunResult } from '../services/laravelApi';
import {
  clickVisible,
  detectNameTooLongValidation,
  dismissCommonOverlays,
  ensureActiveLeadFormRoot,
  ensureConsentInForm,
  ensurePhoneFullyFilled,
  fieldLocator,
  fillField,
  fillMappedSelectsRandom,
  firstNameOnly,
  buildEmailFromName,
  locateVisibleInputByLabel,
  humanWarmupScroll,
  openFormModal,
  openFormModalWithFallbacks,
  resolveFormRoot,
  resolveLeadFieldsInRoot,
  resolveModalFormRoot,
  scrollPageToRevealContent,
  correctSwappedNamePhoneFields,
} from '../utils/formInteractions';
import { observeDomMutations } from '../utils/domMutationWait';
import { SUCCESS_TEXT_PATTERN } from '../utils/formDetectionConstants';
import { pickBrowserFingerprint, RegionPayload } from '../utils/browserProfiles';
import { pickFillBehavior } from '../utils/fillBehaviors';
import { attachFormCaptchaWatcher, resolveCaptcha } from '../utils/captchaHandler';
import { navigateToUrl } from '../utils/navigate';
import { normalizePageUrl } from '../utils/formScanUtils';
import { runPreFormSteps } from '../utils/quizAdvance';
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
  first_name?: string;
  last_name?: string;
  email?: string;
  phone: string;
  region?: RegionPayload;
  mapping: {
    name_selector?: string | null;
    first_name_selector?: string | null;
    last_name_selector?: string | null;
    email_selector?: string | null;
    select_selectors?: string[] | null;
    phone_selector: string;
    submit_selector: string;
    open_modal_selector?: string | null;
    pre_form_click_selectors?: string[] | null;
    pre_form_strategy?: 'selectors' | 'quiz_auto' | null;
    quiz_container_selector?: string | null;
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
      const responseHref = response.url();

      // Captcha / analytics POSTs often return 200 and must not feed successScore.network_ok.
      const isNoiseNetwork = /mc\.yandex|metrika|google-analytics|googletagmanager|facebook\.com\/tr|vk\.com\/rtrg|smartcaptcha|captcha\.yandex|yandexcloud\.net\/check|showcaptcha|checkcaptcha|api-maps\.yandex|log\.api-maps|doubleclick|yandex\.ru\/clck|tildaapi\.com\/event|stat\.tilda|forms\.tildaapi\.com\/procces\/captcha/i.test(
        responseHref,
      );

      if ((method === 'POST' || method === 'PUT' || method === 'PATCH')
        && (status === 200 || status === 201 || status === 204)
        && !isNoiseNetwork) {
        networkOkStatuses.push(status);
      }

      if (!request.url().includes(payload.url) && !responseHref.includes(new URL(payload.url).hostname)) {
        return;
      }

      // Ignore analytics/beacon responses (Yandex Metrika etc.) — they blow DB columns and aren't the form POST.
      if (/mc\.yandex|google-analytics|googletagmanager|facebook\.com\/tr|vk\.com\/rtrg|api-maps\.yandex|log\.api-maps/i.test(responseHref)) {
        return;
      }

      responseUrl = responseHref;
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
    }

    // Quiz/chat funnels: answer steps until phone form appears (or run mapped click chain).
    const hasPreForm = Boolean(
      payload.mapping.pre_form_strategy
      || (Array.isArray(payload.mapping.pre_form_click_selectors)
        && payload.mapping.pre_form_click_selectors.length > 0),
    );
    if (hasPreForm) {
      logger.info(
        {
          strategy: payload.mapping.pre_form_strategy ?? null,
          steps: payload.mapping.pre_form_click_selectors?.length ?? 0,
          quizRoot: payload.mapping.quiz_container_selector ?? null,
        },
        'Running pre-form quiz/chat steps',
      );
      await runPreFormSteps(page, payload.mapping);
      await page.waitForTimeout(500);
    }

    if (!payload.mapping.open_modal_selector) {
      if (payload.mapping.iframe_selector) {
        formRoot = page.locator('body');
      } else if (payload.mapping.form_scope_selector) {
        logger.info({ selector: payload.mapping.form_scope_selector }, 'Using form scope from mapping');
        formRoot = await resolveFormRoot(page, payload.mapping.form_scope_selector);
      } else if (hasPreForm) {
        // After quiz, prefer the form that now contains the phone field.
        formRoot = await resolveFormRoot(page, payload.mapping.form_scope_selector ?? null);
      } else {
        await humanWarmupScroll(page);
        await scrollPageToRevealContent(page);
        formRoot = await resolveFormRoot(page, null);
      }
    } else if (hasPreForm) {
      // Modal opened first, then quiz inside — re-resolve root after steps.
      formRoot = await resolveModalFormRoot(page, payload.mapping.form_scope_selector).catch(
        async () => resolveFormRoot(page, payload.mapping.form_scope_selector ?? null),
      );
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

    let resolvedName = nameCount > 0 && mappedName
      ? mappedName
      : nameFallback;
    let resolvedPhone = phoneCount > 0 ? phoneField : phoneFallback;

    const roleFix = await correctSwappedNamePhoneFields(formRoot, resolvedName, resolvedPhone);
    resolvedName = roleFix.name;
    resolvedPhone = roleFix.phone;

    nameCount = await resolvedName.count();
    phoneCount = await resolvedPhone.count();

    // Only treat name as present if mapping asked for it OR a clear name field is visible.
    const shouldFillName = Boolean(nameSelector) || nameCount > 0 || roleFix.corrected;

    logger.info(
      {
        name: nameSelector || null,
        phone: payload.mapping.phone_selector,
        submit: payload.mapping.submit_selector,
        correctedRoles: roleFix.corrected,
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
      let formScope = formRoot;
      const selectSelectors = Array.isArray(payload.mapping.select_selectors)
        ? payload.mapping.select_selectors.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
        : [];

      logger.info(
        {
          fillPipeline: 'split_select_email_v2',
          selectCount: selectSelectors.length,
          hasFirstName: Boolean((payload.mapping.first_name_selector ?? '').trim()),
          hasLastName: Boolean((payload.mapping.last_name_selector ?? '').trim()),
          hasEmail: Boolean((payload.mapping.email_selector ?? '').trim()),
          firstName: payload.first_name ?? null,
          lastName: payload.last_name ?? null,
          email: payload.email ?? null,
        },
        'Starting extended form fill (selects / split name / email)',
      );

      const firstNameSelector = (payload.mapping.first_name_selector ?? '').trim();
      const lastNameSelector = (payload.mapping.last_name_selector ?? '').trim();
      const emailSelector = (payload.mapping.email_selector ?? '').trim();
      const firstNameValue = (payload.first_name || firstNameOnly(payload.name) || '').trim();
      const lastFromFull = payload.name.trim().split(/\s+/).filter(Boolean).slice(-1)[0] || '';
      const lastNameValue = (payload.last_name || (lastFromFull !== firstNameValue ? lastFromFull : '') || '').trim();
      const emailValue = (payload.email || '').trim() || buildEmailFromName(firstNameValue, lastNameValue);

      const fillBySelectorOrFallback = async (
        label: string,
        selector: string,
        value: string,
        fallback: string,
        labelPattern?: RegExp,
        options?: { onlyIfEmpty?: boolean },
      ): Promise<boolean> => {
        if (!value) {
          return false;
        }

        const maybeFill = async (mapped: ReturnType<typeof fieldLocator> | Awaited<ReturnType<typeof locateVisibleInputByLabel>>, via: string): Promise<boolean> => {
          if (!mapped) {
            return false;
          }
          if ((await mapped.count().catch(() => 0)) < 1) {
            return false;
          }

          if (options?.onlyIfEmpty) {
            const current = await mapped.first().inputValue().catch(() => '');
            if (current && current.replace(/\s+/g, '').length > 0) {
              logger.info({ label, via, skipped: 'already_filled' }, 'Skipped identity field');
              return true;
            }
          }

          await fillField(mapped, value, fillBehavior);
          logger.info({ label, selector: selector || null, via }, 'Filled identity field');
          return true;
        };

        try {
          if (selector) {
            const mapped = fieldLocator(page, payload.mapping, formScope, selector);
            if (await maybeFill(mapped, 'mapped')) {
              return true;
            }
            logger.warn({ label, selector }, 'Mapped identity selector not found — trying fallback');
          }

          const fallbackLoc = formScope.locator(fallback).filter({ visible: true }).first();
          if (await maybeFill(fallbackLoc, 'fallback')) {
            return true;
          }

          if (labelPattern) {
            const byLabel = await locateVisibleInputByLabel(formScope, labelPattern);
            if (await maybeFill(byLabel, 'label')) {
              return true;
            }
          }
        } catch (error) {
          logger.warn(
            { label, selector: selector || null, error: error instanceof Error ? error.message : String(error) },
            'Identity field fill failed',
          );
          return false;
        }

        logger.warn({ label, selector: selector || null }, 'Identity field not filled');
        return false;
      };

      const fillExtendedIdentityFields = async (options?: { includeSelects?: boolean; onlyIfEmpty?: boolean }): Promise<void> => {
        const includeSelects = options?.includeSelects !== false;
        const onlyIfEmpty = options?.onlyIfEmpty === true;

        if (includeSelects && selectSelectors.length > 0) {
          const selectResults = await fillMappedSelectsRandom(page, payload.mapping, formScope, selectSelectors);
          for (const row of selectResults) {
            logger.info({ selectSelector: row.selector, picked: row.picked }, 'Filled select with random option');
          }
          if (!selectResults.some((row) => Boolean(row.picked))) {
            logger.warn({ selectSelectors }, 'Mapped selects present but none were filled');
          }
        }

        if (firstNameSelector || lastNameSelector) {
          await fillBySelectorOrFallback(
            'first_name',
            firstNameSelector,
            firstNameValue,
            'input[autocomplete="given-name"], input[name*="first" i], input[placeholder*="Имя" i], input[aria-label*="Имя" i]',
            /(?:^|[\s:])имя\b|first.?name|given.?name/i,
            { onlyIfEmpty },
          );
          await fillBySelectorOrFallback(
            'last_name',
            lastNameSelector,
            lastNameValue,
            'input[autocomplete="family-name"], input[name*="last" i], input[name*="surname" i], input[placeholder*="Фамили" i], input[aria-label*="Фамили" i]',
            /фамил|last.?name|family.?name|surname/i,
            { onlyIfEmpty },
          );
        }

        // Name is optional: many dealer modals are phone-only (Jaecoo etc.).
        // Prefer split first/last when present; otherwise fill combined FIO field.
        if (nameCount > 0 && shouldFillName && !firstNameSelector && !lastNameSelector) {
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
            if (!onlyIfEmpty || !(await resolvedName.first().inputValue().catch(() => ''))) {
              await fillField(resolvedName, payload.name, fillBehavior);
              await captchaWatch.drain(2000);
            }
          }
        } else if (nameCount > 0 && shouldFillName && nameSelector && (firstNameSelector || lastNameSelector)) {
          const looksLikeCombined = await resolvedName.first().evaluate((el) => {
            const input = el as HTMLInputElement;
            const style = window.getComputedStyle(input);
            const rect = input.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width >= 4 && rect.height >= 4;
          }).catch(() => false);
          if (looksLikeCombined && (!onlyIfEmpty || !(await resolvedName.first().inputValue().catch(() => '')))) {
            await fillField(resolvedName, payload.name, fillBehavior);
          }
        }

        if (
          emailSelector
          || (await formScope.locator('input[type="email"], input[name*="mail" i], input[placeholder*="почт" i]').filter({ visible: true }).count().catch(() => 0)) > 0
          || Boolean(await locateVisibleInputByLabel(formScope, /e-?mail|почт|электронн/i))
        ) {
          await fillBySelectorOrFallback(
            'email',
            emailSelector,
            emailValue,
            'input[type="email"], input[name*="mail" i], input[placeholder*="почт" i], input[placeholder*="Email" i], input[autocomplete="email"]',
            /e-?mail|почт|электронн/i,
            { onlyIfEmpty },
          );
        }
      };

      await fillExtendedIdentityFields({ includeSelects: true });

      await fillField(resolvedPhone, payload.phone, fillBehavior);
      // Phone input often triggers SmartCaptcha 1–3s later — wait for widget + solve.
      await captchaWatch.drain(15000);

      // Promo/action popup may appear while typing — always act inside the topmost lead form.
      let activeRoot = formRoot;
      const retargetAfterPhone = await ensureActiveLeadFormRoot(
        page,
        activeRoot,
        payload.mapping.form_scope_selector,
      );
      activeRoot = retargetAfterPhone.formRoot;
      formScope = activeRoot;

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
        // New modal form — fill once (no selects re-roll on the original page form).
        await fillExtendedIdentityFields({ includeSelects: true });
        await fillField(activeFields.phone, payload.phone, fillBehavior);
        await captchaWatch.drain(8000);
      } else {
        // Same form: only top up empty text fields if React wiped them — never re-open selects.
        await fillExtendedIdentityFields({ includeSelects: false, onlyIfEmpty: true });
      }

      await ensureConsentInForm(
        activeRoot,
        payload.mapping.consent_checkbox_selector,
        payload.mapping.consent_checkbox_selectors,
      );
      await captchaWatch.drain(3000);

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
      await captchaWatch.drain(3000);
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
        await page.waitForTimeout(800);

        try {
          const pageLooksSuccessful = async (): Promise<boolean> => {
            // Keep this strict: bare «спасибо» / «принято» often live in footers and skip captcha solving.
            return page.evaluate(() => {
              const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
              return /успешно\s+отправлен|заявка\s+(?:успешно\s+)?отправлен|заявка\s+принята|спасибо\s+за\s+(?:заявк|обращени)|мы\s+свяжемся|мы\s+перезвоним/i.test(text);
            }).catch(() => false);
          };

          if (await pageLooksSuccessful()) {
            logger.info('Success text already on page after submit — skip post-submit captcha/retarget');
          } else {
            // Name maxlength validation (e.g. «не длиннее 15 символов») — keep phone/captcha, shorten name, resubmit.
            const nameTooLong = await detectNameTooLongValidation(page, activeRoot);
            if (nameTooLong.matched && (await activeFields.name.count()) > 0) {
              const shortName = firstNameOnly(payload.name);
              logger.warn(
                { message: nameTooLong.message, maxHint: nameTooLong.maxHint, shortName },
                'Name too long validation — retrying with first name only',
              );
              await fillField(activeFields.name, shortName, fillBehavior);
              await page.waitForTimeout(400);
              await clickVisible(activeFields.submit).catch(() => undefined);
              await page.waitForLoadState('domcontentloaded').catch(() => undefined);
              await page.waitForTimeout(800);
            }

            if (!(await pageLooksSuccessful())) {
              await captchaWatch.drain(1500);

              // Tilda mounts captcha in a late fullscreen iframe after forms.tildaapi POST.
              await page
                .waitForSelector(
                  'iframe[src*="/procces/captcha"], iframe[src*="forms.tildaapi.com"][src*="captcha"], iframe[src*="smartcaptcha"], iframe[src*="captcha.yandex"], .CheckboxCaptcha, .AdvancedCaptcha',
                  { timeout: 6000, state: 'attached' },
                )
                .catch(() => undefined);

              // Skip blind post-submit captcha re-solve when already solved before submit
              // (stale AdvancedCaptcha/image shell must not burn another RuCaptcha round).
              if (!captchaWatch.wasSolved()) {
                const captchaAfterSubmit = await resolveCaptcha(page, activeRoot, captchaConfig, {
                  appearTimeoutMs: 5000,
                  phase: 'post-submit',
                  allowBlindTokenSolve: false,
                });

                if (captchaAfterSubmit && !(await pageLooksSuccessful())) {
                  captchaSolvedAfterSubmit = true;
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

                  if (retargetAfterCaptcha.switchedToModal) {
                    await ensurePhoneFullyFilled(activeFields.phone, payload.phone).catch(() => undefined);
                  }

                  logger.info('Captcha after submit — clicking submit inside active form');
                  await clickVisible(activeFields.submit).catch(() => undefined);
                  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
                  await captchaWatch.drain(1500);
                  await page.waitForTimeout(800);
                }
              } else {
                logger.info('Captcha already solved before submit — skip post-submit resolve');
              }
            }
          }
        } catch (captchaError) {
          logger.warn({ err: captchaError }, 'Post-submit captcha handling failed — still detecting result');
        }

        await page.waitForTimeout(payload.mapping.wait_after_submit_ms ?? 1500);
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
