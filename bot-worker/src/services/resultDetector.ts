import { Locator, Page } from 'playwright';
import {
  ERROR_TEXT_PATTERN,
  MIN_SUCCESS_SCORE,
  SUCCESS_BUTTON_TEXT_PATTERN,
  SUCCESS_SCORE_BUTTON_DISABLED,
  SUCCESS_SCORE_BUTTON_TEXT,
  SUCCESS_SCORE_FORM_HIDDEN,
  SUCCESS_SCORE_MODAL,
  SUCCESS_SCORE_MUTATION,
  SUCCESS_SCORE_NETWORK_OK,
  SUCCESS_SCORE_TEXT,
  SUCCESS_SCORE_URL,
  SUCCESS_TEXT_PATTERN,
  SUCCESS_URL_PATTERN,
} from '../utils/formDetectionConstants';
import type { DomMutationSummary } from '../utils/domMutationWait';

export type ResultDetectionInput = {
  page: Page;
  initialUrl: string;
  finalUrl: string;
  initialContentHash: string;
  finalContentHash: string;
  pageText?: string | null;
  initialPageText?: string | null;
  responseStatus?: number | null;
  /** POST/PUT responses with 200/201/204 captured during submit. */
  networkOkStatuses?: number[];
  successSelector?: string | null;
  errorSelector?: string | null;
  successText?: string | null;
  errorText?: string | null;
  /** Console logs captured during submit (flash-taxi / drive-cars form.js). */
  consoleMessages?: string[];
  submitSelector?: string | null;
  formScopeSelector?: string | null;
  nameSelector?: string | null;
  phoneSelector?: string | null;
  /**
   * True when we solved an interactive captcha after the first submit
   * and clicked submit again (or captcha widget itself submitted).
   */
  captchaSolvedAfterSubmit?: boolean;
  /** Optional MutationObserver summary collected after submit. */
  mutationSummary?: DomMutationSummary | null;
};

export type ResultDetectionOutput = {
  status: 'success' | 'failed' | 'unknown';
  detected_success_reason?: string;
  detected_error_reason?: string;
};

const CONSOLE_SUCCESS_PATTERN =
  /успешн\w*\s+отправк|форма\s+успешно\s+отправлена|скрываем\s+форму\s+после\s+успешной/i;

async function isReallyVisible(locator: Locator): Promise<boolean> {
  if ((await locator.count()) === 0) {
    return false;
  }

  return locator
    .evaluate((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) !== 0
        && rect.width >= 4
        && rect.height >= 4;
    })
    .catch(() => false);
}

async function isCaptchaChallengeStillOpen(page: Page): Promise<boolean> {
  const url = page.url();
  if (/showcaptcha|checkcaptcha|smartcaptcha\.yandex|captcha\.yandex/i.test(url)) {
    return true;
  }

  // Frame URL alone is enough: Tilda hosts SmartCaptcha under forms.tildaapi.com/procces/captcha/,
  // and the checkbox lives in a nested smartcaptcha.yandexcloud.net/checkbox.ru iframe.
  // Outer shell (#captchaBox) is NOT on the main page — only inside those frames.
  const captchaFrameOpen = page.frames().some((frame) => {
    const frameUrl = frame.url();
    return /procces\/captcha|forms\.tildaapi\.com.*captcha|smartcaptcha\.yandexcloud|captcha\.yandexcloud|checkbox\.ru|\/checkbox\?/i.test(
      frameUrl,
    );
  });
  if (captchaFrameOpen) {
    return true;
  }

  const selectors = [
    '#captchaBox',
    '#captchaframeBox',
    '[data-testid="smartCaptcha-container"]',
    '.AdvancedCaptcha',
    '.AdvancedCaptcha-ImageWrapper',
    '#captcha-slider',
    '[data-testid="thumb"]',
    '.CheckboxCaptcha-Button',
    '.CheckboxCaptcha-Anchor',
    '.CheckboxCaptcha',
    '#checkbox-captcha-form',
    '[data-testid="checkbox-captcha"]',
    '.smart-captcha',
    '[class*="SmartCaptcha"]',
    'iframe[src*="smartcaptcha"]',
    'iframe[src*="captcha.yandex"]',
    'iframe[src*="checkbox.ru"]',
    'iframe[data-testid="checkbox-iframe"]',
    'iframe[data-testid="advanced-iframe"]',
    // Tilda wraps Yandex SmartCaptcha in its own fullscreen captcha iframe.
    'iframe[src*="forms.tildaapi.com"][src*="captcha"]',
    'iframe[src*="tildaapi.com/procces/captcha"]',
    'iframe[src*="/procces/captcha"]',
    // Icons / silhouette challenge (fullscreen overlay after "I'm not a robot").
    '.CaptchaButton',
    '[class*="TaskImage"]',
    '[class*="Silhouette"]',
    'img[class*="Captcha"]',
  ];

  for (const selector of selectors) {
    const node = page.locator(selector).first();
    if ((await node.count()) === 0) {
      continue;
    }

    // Captcha iframes often start with opacity:0 — treat attached oversized frames as open.
    if (/iframe/i.test(selector)) {
      const box = await node.boundingBox().catch(() => null);
      if (box && box.width >= 40 && box.height >= 40) {
        return true;
      }
    }

    if (await isReallyVisible(node)) {
      return true;
    }
  }

  // Inside Tilda/Yandex frames look for shell markers (checkbox itself is in a child iframe).
  for (const frame of page.frames()) {
    const frameUrl = frame.url();
    if (!/smartcaptcha|captcha\.yandex|checkbox|showcaptcha|tildaapi\.com.*captcha|procces\/captcha/i.test(frameUrl)) {
      continue;
    }

    const hasChallenge = await frame
      .evaluate(() => {
        if (
          document.querySelector(
            '#captchaBox, #captchaframeBox, [data-testid="smartCaptcha-container"], .smart-captcha, iframe[data-testid="checkbox-iframe"], iframe[src*="checkbox"], iframe[src*="smartcaptcha"]',
          )
        ) {
          return true;
        }

        const token = document.querySelector(
          'input[name="smart-token"], input[data-testid="smart-token"]',
        ) as HTMLInputElement | null;
        // Empty token + captcha shell = challenge still pending.
        if (token && !(token.value || '').trim()) {
          return true;
        }

        const nodes = document.querySelectorAll(
          '.CheckboxCaptcha-Button, .CheckboxCaptcha, #js-button, #captcha-slider, [data-testid="thumb"], .AdvancedCaptcha, [class*="TaskImage"], [class*="Silhouette"]',
        );
        for (const el of Array.from(nodes)) {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          if (
            style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number(style.opacity) !== 0
            && rect.width >= 4
            && rect.height >= 4
          ) {
            return true;
          }
        }

        return false;
      })
      .catch(() => false);

    if (hasChallenge) {
      return true;
    }
  }

  return false;
}

/** network_ok + DOM noise from captcha overlay must not count as submit success alone. */
function isWeakSuccessOnly(reasons: string[]): boolean {
  const strong = new Set([
    'success_text',
    'success_modal',
    'form_hidden',
    'button_text',
  ]);
  return !reasons.some((reason) => strong.has(reason));
}

async function readFormScopeText(input: ResultDetectionInput): Promise<string> {
  const scope = input.formScopeSelector
    ? input.page.locator(input.formScopeSelector).first()
    : input.page.locator('body');

  if ((await scope.count()) === 0) {
    return '';
  }

  return scope.innerText().catch(() => '');
}

/** rent2buy / flash-taxi / drive-cars: after AJAX success form.js hides fields + submit. */
async function detectFormHiddenAfterSuccess(input: ResultDetectionInput): Promise<boolean> {
  const scope = input.formScopeSelector
    ? input.page.locator(input.formScopeSelector).first()
    : input.page.locator('body');

  if (input.submitSelector) {
    const submit = scope.locator(input.submitSelector).first();
    const pageSubmit = input.page.locator(input.submitSelector).first();
    const button = (await submit.count()) > 0 ? submit : pageSubmit;

    if ((await button.count()) > 0 && !(await isReallyVisible(button))) {
      return true;
    }

    if ((await button.count()) === 0) {
      // Button removed from DOM after success.
      return true;
    }
  }

  const nameSel = input.nameSelector;
  const phoneSel = input.phoneSelector;

  if (nameSel && phoneSel) {
    const name = scope.locator(nameSel).first();
    const phone = scope.locator(phoneSel).first();
    const nameVisible = (await name.count()) > 0 && (await isReallyVisible(name));
    const phoneVisible = (await phone.count()) > 0 && (await isReallyVisible(phone));

    if (!nameVisible && !phoneVisible) {
      return true;
    }
  }

  return false;
}

function textAppearedAfterSubmit(
  pageText: string | null | undefined,
  initialText: string,
  pattern: RegExp,
): boolean {
  if (!pageText || !pattern.test(pageText)) {
    return false;
  }

  return initialText === '' || !pattern.test(initialText);
}

async function detectSubmitButtonSignals(input: ResultDetectionInput): Promise<{
  disabled: boolean;
  textChanged: boolean;
}> {
  if (!input.submitSelector) {
    return { disabled: false, textChanged: false };
  }

  const scope = input.formScopeSelector
    ? input.page.locator(input.formScopeSelector).first()
    : input.page.locator('body');
  const scoped = scope.locator(input.submitSelector).first();
  const button = (await scoped.count()) > 0 ? scoped : input.page.locator(input.submitSelector).first();

  if ((await button.count()) === 0) {
    return { disabled: false, textChanged: false };
  }

  const state = await button.evaluate((el) => {
    const disabled = (el as HTMLButtonElement).disabled
      || el.getAttribute('aria-disabled') === 'true'
      || /disabled|is-disabled|btn-disabled/i.test(typeof el.className === 'string' ? el.className : '');
    const text = `${(el as HTMLElement).innerText || ''} ${(el as HTMLInputElement).value || ''}`.replace(/\s+/g, ' ').trim();

    return { disabled, text };
  }).catch(() => ({ disabled: false, text: '' }));

  return {
    disabled: state.disabled,
    textChanged: Boolean(state.text && SUCCESS_BUTTON_TEXT_PATTERN.test(state.text)),
  };
}

async function detectSuccessModalVisible(page: Page): Promise<boolean> {
  const selectors = [
    '[role="dialog"]',
    '.modal.show',
    '.modal.is-open',
    '.modal.open',
    '.v-modal',
    '.t-popup_show',
    '.popup.open',
    '.toast',
    '.alert-success',
    '[class*="success"]',
  ];

  for (const selector of selectors) {
    const node = page.locator(selector).filter({ visible: true }).first();
    if ((await node.count()) === 0) {
      continue;
    }

    const text = await node.innerText().catch(() => '');
    if (text && SUCCESS_TEXT_PATTERN.test(text)) {
      return true;
    }
  }

  return false;
}

/**
 * Aggregate multi-signal successScore without replacing existing hard checks.
 */
async function computeSuccessScore(input: ResultDetectionInput): Promise<{ score: number; reasons: string[] }> {
  let score = 0;
  const reasons: string[] = [];

  const formText = await readFormScopeText(input);
  let pageText = input.pageText ?? null;
  if (pageText === null) {
    pageText = await input.page.content().catch(() => null);
  }
  const initialText = input.initialPageText ?? '';

  if (
    (formText && SUCCESS_TEXT_PATTERN.test(formText))
    || textAppearedAfterSubmit(pageText, initialText, SUCCESS_TEXT_PATTERN)
  ) {
    score += SUCCESS_SCORE_TEXT;
    reasons.push('success_text');
  }

  if (await detectSuccessModalVisible(input.page)) {
    score += SUCCESS_SCORE_MODAL;
    reasons.push('success_modal');
  }

  if (await detectFormHiddenAfterSuccess(input)) {
    score += SUCCESS_SCORE_FORM_HIDDEN;
    reasons.push('form_hidden');
  }

  const buttonSignals = await detectSubmitButtonSignals(input);
  if (buttonSignals.disabled) {
    score += SUCCESS_SCORE_BUTTON_DISABLED;
    reasons.push('button_disabled');
  }
  if (buttonSignals.textChanged) {
    score += SUCCESS_SCORE_BUTTON_TEXT;
    reasons.push('button_text');
  }

  const networkOk = (input.networkOkStatuses ?? []).some((status) => status === 200 || status === 201 || status === 204)
    || input.responseStatus === 200
    || input.responseStatus === 201
    || input.responseStatus === 204;

  if (networkOk) {
    score += SUCCESS_SCORE_NETWORK_OK;
    reasons.push('network_ok');
  }

  if (input.initialUrl !== input.finalUrl || SUCCESS_URL_PATTERN.test(input.finalUrl)) {
    score += SUCCESS_SCORE_URL;
    reasons.push('url_signal');
  }

  const mutation = input.mutationSummary;
  if (mutation && (mutation.sawSuccessHint || mutation.sawModalHint || mutation.addedNodes > 0)) {
    score += SUCCESS_SCORE_MUTATION;
    reasons.push('dom_mutation');
  }

  return { score, reasons };
}

export async function detectSubmitResult(input: ResultDetectionInput): Promise<ResultDetectionOutput> {
  const urlChanged = input.initialUrl !== input.finalUrl;
  const pageChanged = input.initialContentHash !== input.finalContentHash;
  const captchaUrl = /showcaptcha|checkcaptcha/i.test(input.finalUrl);

  // Captcha overlay hides the form / mutates DOM / may 200 on its own POST —
  // check BEFORE form_hidden / url_changed / successScore.
  if (captchaUrl || await isCaptchaChallengeStillOpen(input.page)) {
    return { status: 'failed', detected_error_reason: 'captcha_still_visible' };
  }

  const consoleHit = (input.consoleMessages ?? []).find((line) => CONSOLE_SUCCESS_PATTERN.test(line));

  if (consoleHit) {
    return { status: 'success', detected_success_reason: 'console_success_log' };
  }

  if (await detectFormHiddenAfterSuccess(input)) {
    return { status: 'success', detected_success_reason: 'form_hidden_after_submit' };
  }

  const formText = await readFormScopeText(input);

  if (formText && SUCCESS_TEXT_PATTERN.test(formText)) {
    return { status: 'success', detected_success_reason: 'success_text_in_form' };
  }

  if (formText && ERROR_TEXT_PATTERN.test(formText)) {
    return { status: 'failed', detected_error_reason: 'error_text_in_form' };
  }

  if (input.successSelector && (await input.page.locator(input.successSelector).count()) > 0) {
    return { status: 'success', detected_success_reason: 'success_selector' };
  }

  if (input.errorSelector && (await input.page.locator(input.errorSelector).count()) > 0) {
    return { status: 'failed', detected_error_reason: 'error_selector' };
  }

  if (urlChanged || SUCCESS_URL_PATTERN.test(input.finalUrl)) {
    return { status: 'success', detected_success_reason: urlChanged ? 'url_changed' : 'success_url_pattern' };
  }

  let pageText = input.pageText ?? null;
  if (pageText === null) {
    pageText = await input.page.content().catch(() => null);
  }

  const initialText = input.initialPageText ?? '';

  if (textAppearedAfterSubmit(pageText, initialText, SUCCESS_TEXT_PATTERN)) {
    return { status: 'success', detected_success_reason: 'success_text_pattern' };
  }

  if (input.successText && pageText?.includes(input.successText)) {
    const wasAlreadyThere = initialText.includes(input.successText);

    if (!wasAlreadyThere) {
      return { status: 'success', detected_success_reason: 'success_text' };
    }
  }

  if (input.errorText && pageText?.includes(input.errorText)) {
    return { status: 'failed', detected_error_reason: 'error_text' };
  }

  if (pageText && ERROR_TEXT_PATTERN.test(pageText) && !ERROR_TEXT_PATTERN.test(initialText)) {
    return { status: 'failed', detected_error_reason: 'error_text_pattern' };
  }

  // Multi-signal successScore (network / button / modal / mutation) before soft fallbacks.
  // Reject weak combos like network_ok+dom_mutation (typical captcha overlay false positive).
  const scored = await computeSuccessScore(input);
  if (scored.score >= MIN_SUCCESS_SCORE && !isWeakSuccessOnly(scored.reasons)) {
    return {
      status: 'success',
      detected_success_reason: `success_score:${scored.score}:${scored.reasons.join('+')}`,
    };
  }

  // Soft success: captcha passed + re-submit + wait, challenge gone, no error signal.
  // Prefer explicit signals above; this is a last resort for sites that only mutate DOM subtly.
  // Re-check captcha: solve may have left a second challenge (icons) on screen.
  if (input.captchaSolvedAfterSubmit) {
    if (await isCaptchaChallengeStillOpen(input.page)) {
      return { status: 'failed', detected_error_reason: 'captcha_still_visible_after_solve' };
    }

    return { status: 'success', detected_success_reason: 'post_captcha_settled' };
  }

  if (pageChanged) {
    return { status: 'unknown', detected_error_reason: 'page_changed_but_no_explicit_signal' };
  }

  return { status: 'unknown', detected_error_reason: 'unknown_result' };
}
