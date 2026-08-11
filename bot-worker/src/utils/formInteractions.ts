import { Locator, Page } from 'playwright';
import pino from 'pino';
import { FillBehaviorId, prepareFieldForTyping, typeWithBehavior } from './fillBehaviors';
import { humanClickLocator } from './humanMouse';

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
  // ONLY real cookie-banner hosts. Broad [class*="cookie"] / "согласен" matches
  // lead-form policy links and navigates away (jetour-marcar.ru → /cookies).
  const cookieHosts = page.locator(
    [
      '[class*="cookie-banner" i]',
      '[class*="cookie_banner" i]',
      '[class*="cookies-banner" i]',
      '[class*="cookie-notice" i]',
      '[class*="cookie-consent" i]',
      '[id*="cookie-banner" i]',
      '[id*="cookies-banner" i]',
      '#cookie-banner',
      '#cookies-banner',
      '#onetrust-banner-sdk',
      '.cc-window',
      '.cookie-notice',
      '[aria-label*="cookie" i][role="dialog"]',
    ].join(', '),
  );

  const candidates = cookieHosts.locator('button, [role="button"]').filter({
    hasText: /принять|согласен|хорошо|понятно|ok|agree|accept|разреш/i,
  });

  const count = Math.min(await candidates.count(), 6);

  for (let index = 0; index < count; index += 1) {
    const target = candidates.nth(index);
    if (!(await target.isVisible().catch(() => false))) {
      continue;
    }

    const meta = await target.evaluate((el) => {
      const anchor = el.closest('a') || (el.tagName === 'A' ? el : null);
      return {
        tag: el.tagName.toLowerCase(),
        href: anchor?.getAttribute('href') || '',
        inForm: Boolean(el.closest('form')),
        role: (el.getAttribute('role') || '').toLowerCase(),
      };
    }).catch(() => null);

    if (!meta) {
      continue;
    }

    // Never follow policy links / never touch lead-form consent.
    if (meta.tag === 'a' || meta.inForm || meta.href) {
      continue;
    }
    if (/cookie|privacy|policy|personal|соглас|политик|\//i.test(meta.href)) {
      continue;
    }

    await target.click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(400);
    break;
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
  // PrimeVue / auto-razgon.ru: credit CTA opens .p-drawer (role=complementary, not dialog)
  '.p-drawer.p-drawer-open',
  '.p-drawer-open .p-drawer',
  '.p-drawer.p-component',
  '.p-drawer-content',
  '[class*="p-drawer"][class*="p-drawer-open"]',
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
  '.p-drawer',
  '.p-drawer-content',
  '[class*="p-drawer"]',
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
  // Do NOT switch just because another on-page block with "modal" in class has different bounds
  // (inline lead forms on dealer SPAs often match [class*="modal"] falsely).
  if (!currentPhoneOk) {
    logger.info(
      { currentPhoneOk },
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
  correctedRoles?: boolean;
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

  let name = mappedName;
  let phone = phoneVisible ? mappedPhone : phoneFallback;
  const corrected = await correctSwappedNamePhoneFields(formRoot, name, phone);
  name = corrected.name;
  phone = corrected.phone;

  return {
    name,
    phone,
    submit: submitVisible ? mappedSubmit : submitFallback,
    usedPhoneFallback: !phoneVisible || corrected.corrected,
    usedSubmitFallback: !submitVisible,
    correctedRoles: corrected.corrected,
  };
}

/**
 * Classify a visible input as name / phone / other using its own attributes
 * (not parent form text — that caused name fields to be saved as phone).
 */
export async function classifyLeadInputRole(locator: Locator): Promise<'name' | 'phone' | 'other'> {
  const count = await locator.count().catch(() => 0);
  if (count === 0) {
    return 'other';
  }

  return locator.filter({ visible: true }).first().evaluate((el) => {
    const input = el as HTMLInputElement;
    const dataType = (input.getAttribute('data-type') || '').toUpperCase();
    if (dataType === 'PHONE' || dataType === 'TEL') {
      return 'phone';
    }
    if (dataType === 'NAME' || dataType === 'FIO') {
      return 'name';
    }

    const type = (input.getAttribute('type') || 'text').toLowerCase();
    const inputMode = (input.getAttribute('inputmode') || '').toLowerCase();
    const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
    if (type === 'tel' || inputMode === 'tel' || autocomplete === 'tel' || autocomplete === 'tel-national') {
      return 'phone';
    }

    const blob = [
      input.getAttribute('name') || '',
      input.id || '',
      input.getAttribute('placeholder') || '',
      input.getAttribute('aria-label') || '',
      typeof input.className === 'string' ? input.className : '',
    ].join(' ');

    const looksPhone = /phone|tel|telefon|телефон|\+7/i.test(blob);
    const looksName = /(?:^|[\s_-])(name|fio|имя|фио)(?:$|[\s_-])|ваше\s+имя|your\s+name/i.test(blob);

    if (looksName && !looksPhone) {
      return 'name';
    }
    if (looksPhone && !looksName) {
      return 'phone';
    }

    return 'other';
  }).catch(() => 'other' as const);
}

/**
 * If mapping put the name field into phone_selector (common scanner bug),
 * retarget locators so fill writes name→name and phone→phone.
 */
export async function correctSwappedNamePhoneFields(
  formRoot: Locator,
  nameLocator: Locator,
  phoneLocator: Locator,
): Promise<{ name: Locator; phone: Locator; corrected: boolean }> {
  const phoneRole = await classifyLeadInputRole(phoneLocator);
  const nameRole = await classifyLeadInputRole(nameLocator);

  const realPhone = formRoot.locator(
    [
      'input[data-type="PHONE"]',
      'input[data-type="TEL"]',
      'input.phone-input',
      'input[type="tel"]',
      'input[inputmode="tel"]',
      'input[name="tel"]',
      'input[name*="phone" i]',
      '#phone',
      'input[placeholder*="+7"]',
      'input[placeholder*="телефон" i]',
      'input[placeholder*="Телефон"]',
    ].join(', '),
  ).filter({ visible: true });

  const realName = formRoot.locator(
    [
      'input[data-type="NAME"]',
      'input[data-type="FIO"]',
      'input.name-input',
      'input[name="name"]',
      'input[name*="name" i]',
      'input[placeholder*="имя" i]',
      'input[placeholder*="Имя"]',
      'input[placeholder*="ФИО" i]',
    ].join(', '),
  ).filter({ visible: true });

  // Classic swap: phone selector → name field, name selector → phone field.
  if (phoneRole === 'name' && nameRole === 'phone') {
    logger.warn('Corrected swapped name/phone selectors (classic swap)');
    return { name: phoneLocator, phone: nameLocator, corrected: true };
  }

  // phone_selector points at name field; name was empty / missing.
  if (phoneRole === 'name') {
    const hasRealPhone = (await realPhone.count()) > 0
      && (await realPhone.first().isVisible().catch(() => false));
    if (hasRealPhone) {
      // Prefer an already-correct name locator; otherwise the mislabeled phone selector is the name field.
      const nameTarget = nameRole === 'name' ? nameLocator : phoneLocator;
      logger.warn(
        { phoneRole, nameRole },
        'phone_selector pointed at name field — retargeted to real phone',
      );
      return { name: nameTarget, phone: realPhone, corrected: true };
    }
  }

  // name_selector points at phone; try to recover name field.
  if (nameRole === 'phone' && phoneRole !== 'phone') {
    const hasRealName = (await realName.count()) > 0
      && (await realName.first().isVisible().catch(() => false));
    if (hasRealName) {
      logger.warn('name_selector pointed at phone field — retargeted');
      return {
        name: realName,
        phone: phoneRole === 'name' || phoneRole === 'other' ? realPhone : phoneLocator,
        corrected: true,
      };
    }
  }

  return { name: nameLocator, phone: phoneLocator, corrected: false };
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

  // Carmir / AutoPlaza / PrimeVue drawer: shell toggles shortly after CTA.
  await Promise.race([
    page.locator('.modal__wrapper, .modal__content, .modal.show, .base-dialog, [role="dialog"], .p-drawer, .p-drawer-content')
      .filter({ visible: true })
      .first()
      .waitFor({ state: 'visible', timeout: 12000 }),
    page.locator(
      '.modal__wrapper input[type="tel"], .modal__content input[type="tel"], [role="dialog"] input[type="tel"], .p-drawer input[type="tel"], .p-drawer-content input[type="tel"]',
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

/**
 * Manual mapping often saves the wrapper (.base-input / .form-group) instead of <input>.
 * Resolve to a real editable control before fill / phone verify / submit guards.
 */
export async function resolveEditableInput(locator: Locator): Promise<Locator> {
  const root = locator.first();
  const count = await root.count().catch(() => 0);
  if (count < 1) {
    return root;
  }

  const tag = await root.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    return root;
  }

  const nestedVisible = root.locator(
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]), textarea, [contenteditable="true"]',
  ).filter({ visible: true }).first();

  if ((await nestedVisible.count().catch(() => 0)) > 0) {
    return nestedVisible;
  }

  const nestedAny = root.locator(
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]), textarea',
  ).first();

  if ((await nestedAny.count().catch(() => 0)) > 0) {
    return nestedAny;
  }

  return root;
}

export async function fillField(
  locator: Locator,
  value: string,
  behavior: FillBehaviorId = 'typo_backspace',
): Promise<void> {
  const input = (await resolveEditableInput(locator)).filter({ visible: true }).first();
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
    : await fitTextToInputLimit(input, value);

  // Masked phones break on backspace/typo patterns — use safer typing.
  const effectiveBehavior = isMaskedPhone ? pickPhoneSafeBehavior(behavior) : behavior;

  if (!isMaskedPhone && typedValue !== value) {
    logger.info(
      { originalLength: value.length, truncatedLength: typedValue.length },
      'Truncated text to input maxlength before typing',
    );
  }

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

/** Honour HTML maxlength; prefer first name when full ФИО does not fit. */
export async function fitTextToInputLimit(locator: Locator, value: string): Promise<string> {
  const maxRaw = await locator.getAttribute('maxlength').catch(() => null)
    ?? await locator.getAttribute('maxLength').catch(() => null);
  const max = maxRaw ? Number.parseInt(maxRaw, 10) : NaN;
  if (!Number.isFinite(max) || max <= 0 || value.length <= max) {
    return value;
  }

  const first = firstNameOnly(value);
  if (first.length > 0 && first.length <= max) {
    return first;
  }

  return value.slice(0, max);
}

/** @deprecated use fitTextToInputLimit */
export async function truncateToInputMaxLength(locator: Locator, value: string): Promise<string> {
  return fitTextToInputLimit(locator, value);
}

/** First token of a full name ("Иван Иванов" → "Иван"). */
export function firstNameOnly(fullName: string): string {
  const trimmed = fullName.trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.split(' ')[0] ?? trimmed;
}

/**
 * Detect visible client-side errors about name being too long (maxlength / «15 символов»).
 */
export async function detectNameTooLongValidation(
  page: Page,
  formRoot: Locator,
): Promise<{ matched: boolean; message: string | null; maxHint: number | null }> {
  const result = await formRoot.evaluate((root) => {
    const blob = (root.textContent || '').replace(/\s+/g, ' ');
    const maxMatch = blob.match(/длиннее[,\s]+чем\s+(\d+)\s*символ/i)
      || blob.match(/не\s+более\s+(\d+)\s*символ/i)
      || blob.match(/максимум\s+(\d+)\s*символ/i)
      || blob.match(/max(?:imum)?\s*(\d+)\s*char/i);
    const tooLong = /не\s+может\s+быть\s+длиннее|слишком\s+длинн|превышает\s+допустим|too\s+long|maxlength/i.test(blob);
    const nameInput = root.querySelector('#af_name, input[name="name"], input[id*="name"], input[placeholder*="Имя"], input[placeholder*="имя"]') as HTMLInputElement | null;
    const maxAttr = nameInput?.getAttribute('maxlength') || nameInput?.getAttribute('maxLength');
    return {
      tooLong: tooLong || Boolean(maxMatch),
      message: maxMatch?.[0] || (tooLong ? blob.slice(0, 160) : null),
      maxHint: maxMatch?.[1] ? Number(maxMatch[1]) : (maxAttr ? Number(maxAttr) : null),
    };
  }).catch(() => ({ tooLong: false, message: null, maxHint: null }));

  // Also scan page-level validation tooltips outside the form root.
  if (!result.tooLong) {
    const pageHit = await page.evaluate(() => {
      const blob = (document.body?.innerText || '').replace(/\s+/g, ' ');
      const maxMatch = blob.match(/длиннее[,\s]+чем\s+(\d+)\s*символ/i);
      if (!maxMatch && !/не\s+может\s+быть\s+длиннее/i.test(blob)) {
        return null;
      }
      return {
        message: maxMatch?.[0] || 'name too long',
        maxHint: maxMatch?.[1] ? Number(maxMatch[1]) : null,
      };
    }).catch(() => null);

    if (pageHit) {
      return { matched: true, message: pageHit.message, maxHint: pageHit.maxHint };
    }
  }

  return {
    matched: Boolean(result.tooLong),
    message: result.message,
    maxHint: result.maxHint && Number.isFinite(result.maxHint) ? result.maxHint : null,
  };
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

  const input = (await resolveEditableInput(locator)).filter({ visible: true }).first();
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
        const inputEl = (
          el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
            ? el
            : el.querySelector('input:not([type="hidden"]), textarea')
        ) as HTMLInputElement | HTMLTextAreaElement | null;

        if (!inputEl) {
          throw new Error('Phone editable input not found inside locator');
        }

        inputEl.focus();

        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          ?? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
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
  await humanClickLocator(target, { force: true, timeoutMs: 10000 });
  await humanPause(target, 280, 700);
}

export async function ensureConsentChecked(locator: Locator): Promise<void> {
  // Native checkboxes are often visually hidden (custom UI overlay) — do NOT require visible.
  const consent = locator.first();
  if ((await consent.count()) === 0) {
    return;
  }

  const meta = await consent.evaluate((el) => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const anchor = el.closest('a') || (tag === 'a' ? el : null);
    const nestedInput = tag === 'input'
      ? null
      : el.querySelector('input[type="checkbox"], input[type="radio"]');

    return {
      tag,
      type,
      role,
      href: anchor?.getAttribute('href') || '',
      isAnchor: Boolean(anchor),
      nestedInputId: nestedInput?.id || null,
      disabled: el instanceof HTMLInputElement
        ? el.disabled
        : el.getAttribute('aria-disabled') === 'true',
    };
  }).catch(() => null);

  if (!meta || meta.disabled) {
    return;
  }

  // Policy / cookies document links must never be "checked".
  if (meta.isAnchor || meta.href) {
    logger.warn(
      { href: meta.href, tag: meta.tag },
      'Consent selector resolved to a link — skipped (would navigate away)',
    );
    return;
  }

  // Wrapper/label with a nested native checkbox → toggle the input, not the wrapper text/links.
  if (meta.tag !== 'input') {
    const nested = consent.locator('input[type="checkbox"], input[type="radio"]').first();
    if ((await nested.count()) > 0) {
      await ensureConsentChecked(nested);
      return;
    }
  }

  if (meta.tag === 'input' && (meta.type === 'checkbox' || meta.type === 'radio')) {
    const checked = await consent.evaluate((el) => (
      el instanceof HTMLInputElement ? el.checked : false
    )).catch(() => false);
    // Already on — never click/check again (would toggle custom UI off).
    if (checked) {
      return;
    }
    await consent.check({ force: true }).catch(async () => {
      await consent.evaluate((el) => {
        if (el instanceof HTMLInputElement) {
          el.checked = true;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }).catch(() => undefined);
    });
    return;
  }

  if (meta.role === 'checkbox') {
    const checked = await consent
      .evaluate((el) => el.getAttribute('aria-checked') === 'true')
      .catch(() => false);

    if (!checked) {
      await humanClickLocator(consent, { force: true, timeoutMs: 5000 }).catch(() => undefined);
    }
    return;
  }

  // Last resort: click non-link control (custom toggle), never follow navigation.
  const navigates = await consent.evaluate((el) => {
    if (el.tagName === 'A' || el.closest('a')) return true;
    if (el instanceof HTMLButtonElement && el.type === 'submit') return true;
    return false;
  }).catch(() => true);

  if (navigates) {
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
    await humanClickLocator(consent, { force: true, timeoutMs: 5000 }).catch(() => undefined);
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

  // Manual mapping left consent empty → do not touch any checkboxes
  // (would toggle Trade-In / uncheck required policy boxes on dealer SPAs).
  if (uniqueSelectors.length === 0) {
    logger.info('Consent selectors empty — skipping all checkboxes');
    return;
  }

  let checked = 0;
  let skipped = 0;
  let missing = 0;

  const isConsentControl = async (item: Locator): Promise<boolean> => {
    const meta = await item.evaluate((el) => {
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase();
      const isAnchor = tag === 'a' || Boolean(el.closest('a'));

      return {
        checkbox: tag === 'input' && (type === 'checkbox' || type === 'radio'),
        aria: role === 'checkbox',
        isAnchor,
      };
    }).catch(() => ({ checkbox: false, aria: false, isAnchor: false }));

    return (meta.checkbox || meta.aria) && !meta.isAnchor;
  };

  const processLocator = async (locator: Locator): Promise<void> => {
    const count = await locator.count();

    if (count === 0) {
      missing += 1;

      return;
    }

    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);

      const itemMeta = await item.evaluate((el) => {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        return {
          tag,
          type,
          isNativeCheckbox: tag === 'input' && (type === 'checkbox' || type === 'radio'),
          isAnchor: tag === 'a' || Boolean(el.closest('a')),
          href: (el.closest('a') || (tag === 'a' ? el : null))?.getAttribute('href') || '',
          disabled: el instanceof HTMLInputElement ? el.disabled : false,
        };
      }).catch(() => null);

      if (!itemMeta) {
        skipped += 1;
        continue;
      }

      // Never click policy / cookies links saved as "consent" by mistake.
      if (itemMeta.isAnchor || itemMeta.href) {
        logger.warn(
          { href: itemMeta.href },
          'Skipping consent candidate that is a link',
        );
        skipped += 1;
        continue;
      }

      // Native checkboxes may be opacity:0 — still toggle them.
      if (!itemMeta.isNativeCheckbox) {
        if (!(await item.isVisible().catch(() => false))) {
          skipped += 1;
          continue;
        }
      }

      if (itemMeta.disabled || await item.isDisabled().catch(() => false)) {
        skipped += 1;
        continue;
      }

      // Old mappings sometimes store a wrapper with 2+ checkboxes inside.
      if (!(await isConsentControl(item))) {
        const nested = item.locator('input[type="checkbox"], input[type="radio"], [role="checkbox"]');
        if ((await nested.count()) > 0) {
          await processLocator(nested);
          continue;
        }
      }

      // Prefer DOM .checked — Playwright isChecked() can lie on opacity:0 / PrimeVue wrappers.
      const alreadyOn = await item.evaluate((el) => {
        if (el instanceof HTMLInputElement) {
          return Boolean(el.checked);
        }

        const nested = el.querySelector('input[type="checkbox"], input[type="radio"]');
        if (nested instanceof HTMLInputElement) {
          return Boolean(nested.checked);
        }

        return el.getAttribute('aria-checked') === 'true';
      }).catch(() => false);

      if (alreadyOn) {
        skipped += 1;
        continue;
      }

      await ensureConsentChecked(item);
      checked += 1;
    }
  };

  for (const selector of uniqueSelectors) {
    await processLocator(formRoot.locator(relativizeSelector(selector)));
  }

  // Mapped selectors missed entirely — log only, do NOT fall back to every form checkbox.
  if (checked === 0 && missing > 0) {
    logger.warn(
      { missing, explicit: uniqueSelectors.length, selectors: uniqueSelectors },
      'Mapped consent selectors not found — leaving checkboxes untouched',
    );
  }

  logger.info({ checked, skipped, missing, explicit: uniqueSelectors.length }, 'Consent checkboxes processed');
}
