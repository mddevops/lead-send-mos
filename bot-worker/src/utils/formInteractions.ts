import { Locator, Page } from 'playwright';
import pino from 'pino';
import { FillBehaviorId, prepareFieldForTyping, typeWithBehavior } from './fillBehaviors';

const logger = pino({ name: 'form-interactions' });

type MappingScope = {
  iframe_selector?: string | null;
  form_scope_selector?: string | null;
};

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanPause(target: Page | Locator, minMs = 250, maxMs = 900): Promise<void> {
  const ms = randomInt(minMs, maxMs);
  if ('page' in target) {
    await target.page().waitForTimeout(ms);
    return;
  }

  await target.waitForTimeout(ms);
}

export async function humanWarmupScroll(page: Page): Promise<void> {
  await page.mouse.wheel(0, randomInt(220, 520));
  await page.waitForTimeout(randomInt(350, 900));
  await page.mouse.wheel(0, randomInt(-180, -60));
  await page.waitForTimeout(randomInt(250, 700));
}

/** Scroll through the full page so footer / lazy-rendered blocks (SPA) appear in the live DOM. */
export async function scrollPageToRevealContent(page: Page): Promise<void> {
  const steps = 6;

  for (let step = 1; step <= steps; step += 1) {
    await page.evaluate(({ currentStep, totalSteps }) => {
      const height = Math.max(
        document.body?.scrollHeight ?? 0,
        document.documentElement?.scrollHeight ?? 0,
      );
      window.scrollTo({ top: Math.ceil((height / totalSteps) * currentStep), behavior: 'auto' });
    }, { currentStep: step, totalSteps: steps });
    await page.waitForTimeout(randomInt(350, 650));
  }

  await page.waitForTimeout(randomInt(700, 1200));
}

export async function dismissCommonOverlays(page: Page): Promise<void> {
  // Prefer cookie-banner scoped controls — broad "согласен" matches Tilda lead-form
  // consent links and can navigate away from the landing (empty DOM for the scanner).
  const cookieButtons = [
    page.locator('[class*="cookie" i], [id*="cookie" i], [class*="consent" i], .cookies, #cookies')
      .locator('a, button, [role="button"]')
      .filter({ hasText: /принять|согласен|хорошо|понятно|ok/i }),
    page.getByRole('button', { name: /^принять$/i }),
    page.getByRole('button', { name: /^я согласен$/i }),
    page.getByRole('button', { name: /^хорошо$/i }),
    page.getByRole('button', { name: /^понятно$/i }),
    page.locator('a, button, [role="button"]').filter({ hasText: /^принять$/i }),
    page.locator('a, button, [role="button"]').filter({ hasText: /^я согласен$/i }),
    page.locator('a, button, [role="button"]').filter({ hasText: /^понятно$/i }),
  ];

  for (const button of cookieButtons) {
    if ((await button.count()) > 0 && (await button.first().isVisible().catch(() => false))) {
      await button.first().click({ timeout: 2000 }).catch(() => undefined);
      await page.waitForTimeout(400);
      break;
    }
  }
}

export async function resolveFormRoot(page: Page, scopeSelector?: string | null): Promise<Locator> {
  const scope = scopeSelector?.trim();
  if (scope) {
    const root = page.locator(scope).first();
    await root.waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(300);
    return root;
  }

  return resolveVisibleFormRoot(page);
}

export async function resolveVisibleFormRoot(page: Page): Promise<Locator> {
  const candidates = [
    '.base-dialog form.form--modal',
    '.base-dialog form.modal__form',
    '.base-dialog form',
    '.base-dialog-overlay form',
    '.modal.is-open form',
    '.modal.open form',
    '.modal.show form',
    '.fancybox-container.fancybox-is-open .fancybox-content',
    '.fancybox-container.fancybox-is-open',
    '.fancybox-content',
    '[role="dialog"] form',
    '[role="dialog"]',
    '.modal.is-open',
    '.modal.show',
    '.mfp-wrap',
    'form.modal-form:visible',
    'form.form--modal:visible',
    'form:visible',
  ];

  for (const selector of candidates) {
    const root = page.locator(selector).last();
    const visible = await root.isVisible().catch(() => false);
    const hasFields = (await root.locator('input, textarea, button[type="submit"], button.button--form, button.form__btn, button').count()) > 0;

    if (visible && hasFields) {
      return root;
    }
  }

  return page.locator('body');
}

/** CSS for open modal shells (Jaecoo base-dialog, Bootstrap, Fancybox, promo popups…). */
export const OPEN_MODAL_SHELL_SELECTOR = [
  '.base-dialog-overlay .base-dialog',
  '.base-dialog',
  '[role="dialog"]',
  'dialog[open]',
  '.modal.show',
  '.modal.is-open',
  '.modal.open',
  // Dealer SPAs (авто-ск etc.): open via display:block, BEM modifier, no Bootstrap .show
  '.modal.modal--credit',
  '.modal.modal--callback',
  '.modal.modal--form',
  '.modal.modal--order',
  '.modal.modal--lead',
  '.modal.modal--phone',
  '.modal.modal--request',
  '.modal.is-active',
  '.modal.is-visible',
  '.modal--active',
  '.modal--opened',
  '.modal_active',
  '.modal_opened',
  // Carmir / AutoPlaza: .modal__wrapper { display:block } with formless inputs
  '.modal__wrapper',
  '.modal__content',
  '.v-modal',
  '.v-modal.is-open',
  '.v-modal--open',
  // Tilda popups (moskvich / marcarlada promo pages)
  '.t-popup.t-popup_show',
  '.t-popup_show',
  '[class*="t-popup"][class*="t-popup_show"]',
  '.fancybox-container.fancybox-is-open .fancybox-content',
  '.fancybox-is-open .fancybox-content',
  '.mfp-wrap.mfp-ready .mfp-content',
  // Promo / action popups that appear while typing phone
  '.popup.open',
  '.popup.is-open',
  '.popup_show',
  '.popup--active',
  '.popup.active',
  '.ui-dialog',
  '.b24-form',
  '.bx-modal',
  '[class*="popup"][class*="open"]',
  '[class*="Popup"][class*="open"]',
  '[class*="modal"][class*="active"]',
  '[class*="Modal"][class*="open"]',
  '.overlay.active .popup',
  '.overlay.show .popup',
].join(', ');

/** Visible modal/dialog that contains a lead phone field (when open-state classes are missing). */
const LEAD_MODAL_FALLBACK_SELECTOR = [
  '.modal',
  '.modal__wrapper',
  '.modal__content',
  '.v-modal',
  '.t-popup',
  '[role="dialog"]',
  'dialog',
  '.popup',
  '.fancybox-content',
].join(', ');

/**
 * Topmost visible modal/popup that contains a lead phone field.
 * Used when a promo overlay appears during fill and steals focus from the original form.
 */
export async function findForegroundLeadModalRoot(page: Page): Promise<Locator | null> {
  const shells = page.locator(OPEN_MODAL_SHELL_SELECTOR).filter({ visible: true });
  const count = await shells.count();

  if (count < 1) {
    // Fallback: any fixed/absolute overlay with phone + button
    const overlay = page.locator(
      'div[style*="z-index"], .popup, .modal, [class*="popup"], [class*="modal"], [class*="Popup"], [class*="Modal"]',
    ).filter({ visible: true });

    const overlayCount = Math.min(await overlay.count(), 12);

    for (let index = overlayCount - 1; index >= 0; index -= 1) {
      const candidate = overlay.nth(index);
      if (await modalLooksLikeLeadForm(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  // Last visible shell is usually the topmost (DOM order / stacked modals).
  for (let index = count - 1; index >= 0; index -= 1) {
    const shell = shells.nth(index);
    if (!(await shell.isVisible().catch(() => false))) {
      continue;
    }

    if (await modalLooksLikeLeadForm(shell)) {
      const form = shell.locator('form').filter({ visible: true }).first();
      if ((await form.count()) > 0) {
        return form;
      }

      return shell;
    }
  }

  return null;
}

async function modalLooksLikeLeadForm(root: Locator): Promise<boolean> {
  const phone = root.locator(
    [
      'input[type="tel"]',
      'input[data-type="PHONE"]',
      'input.phone-input',
      'input[name="tel"]',
      'input[name*="phone" i]',
      '#phone',
      'input[placeholder*="тел" i]',
      'input[placeholder*="+7"]',
      'input[inputmode="tel"]',
    ].join(', '),
  ).filter({ visible: true }).first();

  const submit = root.locator(
    [
      'button[type="submit"]',
      'input[type="submit"]',
      'button[data-submit]',
      'button.button--form',
      'div.button.button--form',
      'div.button--form',
      'button.form__btn',
      'button.btn',
      'div.button',
      'div.btn',
      '[role="button"]',
      'a.btn',
      'button',
    ].join(', '),
  ).filter({ visible: true }).first();

  const hasPhone = (await phone.count()) > 0 && (await phone.isVisible().catch(() => false));
  if (!hasPhone) {
    return false;
  }

  // Prefer roots that also have a clickable submit-ish control.
  const hasSubmit = (await submit.count()) > 0 && (await submit.isVisible().catch(() => false));
  return hasSubmit;
}

/**
 * If a promo/action modal appeared over the page, retarget work into that form.
 * Returns the active form root (modal or original).
 */
export async function ensureActiveLeadFormRoot(
  page: Page,
  currentRoot: Locator,
  preferredScope?: string | null,
): Promise<{ formRoot: Locator; switchedToModal: boolean }> {
  const foreground = await findForegroundLeadModalRoot(page);

  if (!foreground) {
    return { formRoot: currentRoot, switchedToModal: false };
  }

  // Prefer preferred scope inside the foreground modal when present.
  let target = foreground;
  if (preferredScope?.trim()) {
    const scoped = foreground.locator(preferredScope.trim()).filter({ visible: true }).first();
    if ((await scoped.count()) > 0) {
      target = scoped;
    }
  }

  // Detect whether current root is still the interactable lead form.
  const currentPhone = currentRoot.locator(
    'input[type="tel"], input[data-type="PHONE"], input.phone-input, input[name="tel"], #phone, input[name*="phone" i]',
  ).filter({ visible: true }).first();
  const currentPhoneOk = (await currentPhone.count()) > 0
    && (await currentPhone.isVisible().catch(() => false))
    && (await currentPhone.isEnabled().catch(() => true));

  // If current phone is covered / gone but a modal form exists — switch.
  // Also switch when a second stacked modal appeared (promo over form).
  const foregroundBox = await foreground.boundingBox().catch(() => null);
  const currentBox = await currentRoot.boundingBox().catch(() => null);
  const looksLikeNewOverlay = Boolean(
    foregroundBox
    && currentBox
    && (
      Math.abs(foregroundBox.x - currentBox.x) > 20
      || Math.abs(foregroundBox.y - currentBox.y) > 20
      || Math.abs(foregroundBox.width - currentBox.width) > 40
    ),
  );

  if (!currentPhoneOk || looksLikeNewOverlay) {
    logger.info(
      { currentPhoneOk, looksLikeNewOverlay },
      'Retargeted fill/submit to foreground lead modal',
    );
    return { formRoot: target, switchedToModal: true };
  }

  // Same modal / still interactable — keep current root (stable selectors).
  return { formRoot: currentRoot, switchedToModal: false };
}

export async function resolveLeadFieldsInRoot(
  page: Page,
  mapping: MappingScope & {
    name_selector?: string | null;
    phone_selector: string;
    submit_selector: string;
  },
  formRoot: Locator,
): Promise<{
  name: Locator;
  phone: Locator;
  submit: Locator;
  usedPhoneFallback: boolean;
  usedSubmitFallback: boolean;
}> {
  const nameSelector = (mapping.name_selector ?? '').trim();
  const mappedPhone = fieldLocator(page, mapping, formRoot, mapping.phone_selector);
  const mappedSubmit = fieldLocator(page, mapping, formRoot, mapping.submit_selector);
  const mappedName = nameSelector
    ? fieldLocator(page, mapping, formRoot, nameSelector)
    : formRoot.locator(
      'input[data-type="NAME"], input.name-input, input[placeholder*="имя" i], input[placeholder*="Имя"], input[name*="name" i]',
    );

  const phoneFallback = formRoot.locator(
    'input[data-type="PHONE"], input.phone-input, input[type="tel"], input[name="tel"], #phone, input[name*="phone" i], input[placeholder*="+7"], input[inputmode="tel"]',
  ).filter({ visible: true });

  const submitFallback = formRoot.locator(
    [
      'button[type="submit"]',
      'input[type="submit"]',
      'button[data-submit]',
      'button.button--form',
      'div.button.button--form',
      'div.button--form',
      'button.form__btn',
      'button.btn-primary',
      'button:has-text("Отправить")',
      'div.button:has-text("Отправить")',
      'button:has-text("Оставить")',
      'button:has-text("Жду звонка")',
      'button:has-text("Перезвоните")',
      'button:has-text("Заказать")',
      'button:has-text("Получить")',
      'button.btn',
      'div.button',
    ].join(', '),
  ).filter({ visible: true });

  const phoneVisible = (await mappedPhone.count()) > 0
    && (await mappedPhone.filter({ visible: true }).first().isVisible().catch(() => false));
  const submitVisible = (await mappedSubmit.count()) > 0
    && (await mappedSubmit.filter({ visible: true }).first().isVisible().catch(() => false));

  return {
    name: mappedName,
    phone: phoneVisible ? mappedPhone : phoneFallback,
    submit: submitVisible ? mappedSubmit : submitFallback,
    usedPhoneFallback: !phoneVisible,
    usedSubmitFallback: !submitVisible,
  };
}

/**
 * Resolve the visible modal shell after CTA click.
 * Must not fall back to page body / footer forms behind the overlay.
 */
export async function resolveOpenModalShell(page: Page, timeoutMs = 15000): Promise<Locator> {
  const known = page.locator(OPEN_MODAL_SHELL_SELECTOR).filter({ visible: true }).last();

  try {
    await known.waitFor({ state: 'visible', timeout: Math.min(timeoutMs, 6000) });
    await page.waitForTimeout(300);

    return known;
  } catch {
    // Some dealer themes toggle only display:block on `.modal.modal--*` without .show/.open.
    const fallback = page
      .locator(LEAD_MODAL_FALLBACK_SELECTOR)
      .filter({ visible: true })
      .filter({
        has: page.locator(
          'input[type="tel"], input[inputmode="tel"], input[placeholder*="елефон" i], input[placeholder*="+7"], input[placeholder*="Телефон" i], input[name*="phone" i], input[name="tel"]',
        ),
      })
      .last();

    await fallback.waitFor({ state: 'visible', timeout: Math.max(1500, timeoutMs - 6000) });
    await page.waitForTimeout(300);

    return fallback;
  }
}

/**
 * Form root strictly inside the open modal.
 * preferredScope is applied only inside the modal — never against the full page.
 */
export async function resolveModalFormRoot(
  page: Page,
  preferredScope?: string | null,
  timeoutMs = 15000,
): Promise<Locator> {
  const shell = await resolveOpenModalShell(page, timeoutMs);

  if (preferredScope?.trim()) {
    const scoped = shell.locator(preferredScope.trim()).filter({ visible: true }).first();

    if ((await scoped.count()) > 0) {
      return scoped;
    }
  }

  const form = shell.locator('form').filter({ visible: true }).first();

  if ((await form.count()) > 0) {
    return form;
  }

  // Some widgets put inputs directly in the dialog without <form>.
  const phone = shell.locator(
    'input[type="tel"], input[name="tel"], #phone, input[data-type="PHONE"], input[placeholder*="елефон" i], input[placeholder*="Телефон" i], input[placeholder*="+7"]',
  ).first();

  if ((await phone.count()) > 0) {
    return shell;
  }

  throw new Error('Модальное окно открылось, но форма внутри него не найдена');
}

export async function waitForModalForm(page: Page, timeoutMs = 20000): Promise<Locator> {
  return resolveModalFormRoot(page, null, timeoutMs);
}

export async function openFormModal(page: Page, openSelector: string): Promise<void> {
  const trigger = page.locator(openSelector).filter({ visible: true }).first();

  try {
    // SPA cards hydrate CTAs after paint — do not fail on an immediate count()===0.
    await trigger.waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    throw new Error(`Кнопка открытия формы не найдена или скрыта: ${openSelector}`);
  }

  await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
  await page.waitForTimeout(400);

  // Prefer a real click first — force can miss SPA handlers on some dealer themes.
  await trigger.click({ timeout: 10000 }).catch(async () => {
    await clickVisible(trigger);
  });

  // Carmir / AutoPlaza: modal shell toggles display:block shortly after CTA.
  await Promise.race([
    page.locator('.modal__wrapper, .modal__content, .modal.show, .base-dialog, [role="dialog"]')
      .filter({ visible: true })
      .first()
      .waitFor({ state: 'visible', timeout: 12000 }),
    page.locator(
      '.modal__wrapper input[type="tel"], .modal__content input[type="tel"], [role="dialog"] input[type="tel"]',
    )
      .filter({ visible: true })
      .first()
      .waitFor({ state: 'visible', timeout: 12000 }),
    page.waitForTimeout(1200),
  ]).catch(() => undefined);

  await resolveOpenModalShell(page, 15000);
}

/**
 * Fallback CTAs when saved open_modal_selector misses (dealer SPA / delayed hydrate).
 */
export async function openFormModalWithFallbacks(
  page: Page,
  openSelector?: string | null,
): Promise<string> {
  const candidates = [
    openSelector?.trim() || '',
    // Prefer explicit lead CTAs over generic class tokens.
    'div.button.button--credit',
    'div.button--credit:has-text("Купить в кредит")',
    'div.button.trade-in',
    'div.button--info:has-text("Trade-In")',
    'button.offer__page-controls-bottom-callback',
    'button.offer__page-controls-button',
    'button:has-text("Обратный звонок")',
    'div.button:has-text("Купить в кредит")',
    'div.button:has-text("Обменять по Trade-In")',
    'button:has-text("Заказать звонок")',
    'a:has-text("Обратный звонок")',
  ].filter(Boolean);

  const tried = new Set<string>();
  let lastError: Error | null = null;

  for (const selector of candidates) {
    if (tried.has(selector)) {
      continue;
    }
    tried.add(selector);

    try {
      await openFormModal(page, selector);
      return selector;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(300);
    }
  }

  throw lastError ?? new Error('Не удалось открыть модальную форму');
}

export async function closeOpenModal(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.locator([
    '.base-dialog__close',
    '.base-dialog .base-button--icon-only',
    '.modal .close',
    '.fancybox-close',
    '[data-fancybox-close]',
    '.mfp-close',
    '[aria-label="Close"]',
    'button[aria-label="Закрыть"]',
  ].join(', ')).filter({ visible: true }).first()
    .click({ timeout: 1500 })
    .catch(() => undefined);

  await page.waitForTimeout(350);
}

/** Strip scope prefix saved by admin builder (e.g. "form.about__callback input[name=name]") when searching inside formRoot. */
export function relativizeSelector(selector: string, scopeSelector?: string | null): string {
  let current = selector.trim();

  if (scopeSelector) {
    const scope = scopeSelector.trim();

    if (current === scope) {
      return current;
    }

    if (current.startsWith(`${scope} `)) {
      current = current.slice(scope.length).trim();
    }
  }

  while (current.length > 0) {
    const withoutScope = current
      .replace(/^(?:form(?:\.[a-z0-9_-]+)+|form#[a-z0-9_-]+)\s+/i, '')
      .replace(/^(?:[a-z][a-z0-9-]*(?:\.[a-z0-9_-]+)*|form)#[a-z0-9_-]+\s+/i, '')
      .replace(/^#[a-z0-9_-]+\s+/i, '');

    if (withoutScope === current) {
      break;
    }

    current = withoutScope;
  }

  return current;
}

export function fieldLocator(page: Page, mapping: MappingScope, formRoot: Locator, selector: string): Locator {
  const relativeSelector = relativizeSelector(selector, mapping.form_scope_selector ?? null);

  if (mapping.iframe_selector) {
    return page.frameLocator(mapping.iframe_selector).locator(relativeSelector);
  }

  return formRoot.locator(relativeSelector);
}

export async function fillField(
  locator: Locator,
  value: string,
  behavior: FillBehaviorId = 'typo_backspace',
): Promise<void> {
  const input = locator.filter({ visible: true }).first();
  await input.waitFor({ state: 'visible', timeout: 20000 });
  await prepareFieldForTyping(input);

  const inputType = (await input.getAttribute('type'))?.toLowerCase() ?? 'text';
  const placeholder = ((await input.getAttribute('placeholder')) ?? '').replace(/\s+/g, '');
  const hasPhoneMask = (await input.getAttribute('data-phone-pattern')) !== null;
  const inputName = ((await input.getAttribute('name')) ?? '').toLowerCase();
  const isMaskedPhone =
    (await input.getAttribute('id')) === 'phone' ||
    inputName === 'phone' ||
    inputName.includes('phone') ||
    (await input.getAttribute('name')) === 'telephone' ||
    inputType === 'tel' ||
    inputType === 'phone' ||
    hasPhoneMask ||
    placeholder.startsWith('+7') ||
    placeholder.startsWith('8(') ||
    /^\+?7[\d(]/.test(placeholder);

  const typedValue = isMaskedPhone
    ? normalizePhoneDigits(value)
    : value;

  // Masked phones break on backspace/typo patterns — use safer typing.
  const effectiveBehavior = isMaskedPhone ? pickPhoneSafeBehavior(behavior) : behavior;

  logger.info(
    { behavior: effectiveBehavior, requestedBehavior: behavior, isPhone: isMaskedPhone, length: typedValue.length },
    'Filling field with behavior',
  );

  await typeWithBehavior(input, typedValue, effectiveBehavior, { isPhone: isMaskedPhone });

  await input.dispatchEvent('input').catch(() => undefined);
  await input.dispatchEvent('change').catch(() => undefined);

  if (isMaskedPhone) {
    await ensurePhoneFullyFilled(input, value);
  }
}

const PHONE_UNSAFE_BEHAVIORS = new Set<FillBehaviorId>([
  'typo_backspace',
  'overshoot_backspace',
  'select_all_retype',
  'clear_retype',
]);

function pickPhoneSafeBehavior(behavior: FillBehaviorId): FillBehaviorId {
  if (!PHONE_UNSAFE_BEHAVIORS.has(behavior)) {
    return behavior;
  }

  const safe: FillBehaviorId[] = ['slow_careful', 'chunk_pause', 'hesitate_mid', 'two_speed', 'fast_burst'];
  return safe[Math.floor(Math.random() * safe.length)]!;
}

/** Last 10 national digits (without country code 7/8). */
export function normalizePhoneDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length >= 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return digits.slice(-10);
  }
  return digits.slice(-10);
}

async function readPhoneDigitsFromInput(locator: Locator): Promise<string> {
  const fromValue = await locator.inputValue().catch(() => '');
  let digits = normalizePhoneDigits(fromValue);

  if (digits.length >= 10) {
    return digits.slice(-10);
  }

  // Some masks keep display text out of .value briefly — also check attributes.
  const fromAttr = await locator.evaluate((el) => {
    const input = el as HTMLInputElement;
    return [
      input.value || '',
      input.getAttribute('value') || '',
      input.dataset.value || '',
      input.textContent || '',
    ].join(' ');
  }).catch(() => '');

  digits = normalizePhoneDigits(fromAttr);
  return digits.slice(-10);
}

/**
 * Wait until the phone input holds the full expected number (10 digits).
 * Retypes slowly if the mask ate a digit or typing lagged before submit.
 */
export async function ensurePhoneFullyFilled(
  locator: Locator,
  expectedPhone: string,
  options?: { maxAttempts?: number },
): Promise<void> {
  const expected = normalizePhoneDigits(expectedPhone);
  if (expected.length < 10) {
    logger.warn({ expected, raw: expectedPhone }, 'Expected phone has fewer than 10 digits');
  }

  const input = locator.filter({ visible: true }).first();
  const page = input.page();
  const maxAttempts = options?.maxAttempts ?? 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Let Inputmask / IMask / jQuery mask finish applying.
    await page.waitForTimeout(randomInt(450, 850));

    let current = await readPhoneDigitsFromInput(input);

    if (expected.length >= 10 && current === expected) {
      logger.info({ attempt, phone: current }, 'Phone field verified complete before submit');
      return;
    }

    if (expected.length < 10 && current === expected && current.length > 0) {
      return;
    }

    logger.warn(
      { attempt, expected, current, currentLength: current.length },
      'Phone incomplete or mismatched — refilling carefully',
    );

    await prepareFieldForTyping(input);
    await typeWithBehavior(input, expected, 'slow_careful', { isPhone: true });
    await input.dispatchEvent('input').catch(() => undefined);
    await input.dispatchEvent('change').catch(() => undefined);
    await page.waitForTimeout(randomInt(500, 900));

    current = await readPhoneDigitsFromInput(input);
    if (current === expected) {
      logger.info({ attempt, phone: current }, 'Phone refilled successfully');
      return;
    }

    // Last resort: set via native value setter + input events (React/masks).
    if (attempt === maxAttempts || current.length < expected.length) {
      await input.evaluate((el, digits) => {
        const inputEl = el as HTMLInputElement;
        inputEl.focus();

        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        const fire = (value: string, data?: string) => {
          if (nativeSetter) {
            nativeSetter.call(inputEl, value);
          } else {
            inputEl.value = value;
          }
          inputEl.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            data,
            inputType: 'insertText',
          }));
        };

        fire('');
        let built = '';
        for (const digit of digits) {
          built += digit;
          fire(built, digit);
        }

        // Common RU mask display if still short.
        const shown = (inputEl.value || '').replace(/\D/g, '').replace(/^7|^8/, '').slice(-10);
        if (shown !== digits) {
          const formatted = `+7 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`;
          fire(formatted);
        }

        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        inputEl.dispatchEvent(new Event('blur', { bubbles: true }));
        inputEl.dispatchEvent(new Event('keyup', { bubbles: true }));
      }, expected);

      await page.waitForTimeout(randomInt(400, 700));
      current = await readPhoneDigitsFromInput(input);

      if (current === expected) {
        logger.info({ attempt, phone: current }, 'Phone forced via native setter');
        return;
      }
    }
  }

  const finalValue = await readPhoneDigitsFromInput(input);
  throw new Error(
    `Телефон в поле неполный перед отправкой: ожидалось ${expected} (10 цифр), в поле «${finalValue || 'пусто'}».`,
  );
}

export async function clickVisible(locator: Locator): Promise<void> {
  const target = locator.filter({ visible: true }).first();
  await target.waitFor({ state: 'visible', timeout: 20000 });
  await target.scrollIntoViewIfNeeded();
  await humanPause(target, 350, 900);
  await target.click({ timeout: 10000, force: true });
  await humanPause(target, 280, 700);
}

export async function ensureConsentChecked(locator: Locator): Promise<void> {
  const consent = locator.filter({ visible: true }).first();
  if ((await consent.count()) === 0) {
    return;
  }

  const disabled = await consent.isDisabled().catch(() => false);
  const ariaDisabled = (await consent.getAttribute('aria-disabled').catch(() => null)) === 'true';

  if (disabled || ariaDisabled) {
    return;
  }

  const tagName = await consent.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
  const inputType = (await consent.getAttribute('type'))?.toLowerCase();
  const role = (await consent.getAttribute('role'))?.toLowerCase();

  if (tagName === 'input' && (inputType === 'checkbox' || inputType === 'radio')) {
    const checked = await consent.isChecked().catch(() => false);
    if (!checked) {
      await consent.check({ force: true }).catch(async () => {
        await consent.click({ timeout: 5000, force: true }).catch(() => undefined);
      });
    }
    return;
  }

  if (role === 'checkbox') {
    const checked = await consent
      .evaluate((el) => el.getAttribute('aria-checked') === 'true')
      .catch(() => false);

    if (!checked) {
      await consent.click({ timeout: 5000, force: true }).catch(() => undefined);
    }
    return;
  }

  const alreadyChecked = await consent
    .evaluate((el) => {
      if (el instanceof HTMLInputElement) {
        return el.checked;
      }

      return el.getAttribute('aria-checked') === 'true';
    })
    .catch(() => false);

  if (!alreadyChecked) {
    await consent.click({ timeout: 5000, force: true }).catch(() => undefined);
  }
}

export async function ensureConsentInForm(
  formRoot: Locator,
  customSelector?: string | null,
  customSelectors?: string[] | null,
): Promise<void> {
  const explicitSelectors = [
    ...(customSelectors ?? []),
    customSelector,
  ].filter((selector): selector is string => Boolean(selector && selector.trim() !== ''));

  const uniqueSelectors = [...new Set(explicitSelectors)];
  let checked = 0;
  let skipped = 0;
  let missing = 0;

  const processLocator = async (locator: Locator): Promise<void> => {
    const count = await locator.count();

    if (count === 0) {
      missing += 1;

      return;
    }

    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);

      if (!(await item.isVisible().catch(() => false))) {
        skipped += 1;
        continue;
      }

      if (await item.isDisabled().catch(() => false)) {
        skipped += 1;
        continue;
      }

      const alreadyOn = await item.isChecked().catch(async () => (
        (await item.getAttribute('aria-checked').catch(() => null)) === 'true'
      ));

      if (alreadyOn) {
        skipped += 1;
        continue;
      }

      await ensureConsentChecked(item);
      checked += 1;
    }
  };

  if (uniqueSelectors.length > 0) {
    for (const selector of uniqueSelectors) {
      await processLocator(formRoot.locator(relativizeSelector(selector)));
    }
  } else {
    // 0 / 1 / 2+ consent boxes — check all visible enabled ones, leave already-checked alone.
    await processLocator(formRoot.locator('input[type="checkbox"]'));
  }

  logger.info({ checked, skipped, missing, explicit: uniqueSelectors.length }, 'Consent checkboxes processed');
}
