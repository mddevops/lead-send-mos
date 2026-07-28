import { Page } from 'playwright';
import {
  CALLBACK_ENTRY_PATTERN,
  ENTRY_POINT_TEXT_PATTERN,
  HASH_WIDGET_HREF_PATTERN,
  MIN_FORM_SCORE,
  MODAL_CONTAINER_SELECTORS,
  SERVICE_ENTRY_PATTERN,
  STICKY_WIDGET_TEXT_PATTERN,
} from './formDetectionConstants';
import { closeOpenModal, OPEN_MODAL_SHELL_SELECTOR, resolveOpenModalShell } from './formInteractions';
import { MAX_MODAL_TRIGGERS_PER_PAGE } from './formScanUtils';
import type { DetectedFormMapping } from './formScanner';

type EntryPoint = {
  selector: string;
  text: string;
  href: string | null;
  priority: number;
};

type RawDetectedForm = {
  formScopeSelector: string | null;
  nameSelector: string | null;
  phoneSelector: string;
  submitSelector: string;
  consentCheckboxSelectors: string[];
  fingerprint: string;
  score: number;
};

const ENTRY_POINT_EVALUATOR = `(() => {
  const PATTERN = ${ENTRY_POINT_TEXT_PATTERN.toString()};
  const CALLBACK_RE = ${CALLBACK_ENTRY_PATTERN.toString()};
  const SERVICE_RE = ${SERVICE_ENTRY_PATTERN.toString()};
  const HASH_WIDGET_RE = ${HASH_WIDGET_HREF_PATTERN.toString()};
  const STICKY_RE = ${STICKY_WIDGET_TEXT_PATTERN.toString()};

  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isFixedOrSticky(el) {
    let node = el;
    for (let i = 0; i < 6 && node; i++) {
      if (!(node instanceof HTMLElement)) break;
      const pos = window.getComputedStyle(node).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
      node = node.parentElement;
    }
    return false;
  }

  function elementText(el) {
    return (el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('value') || '').trim();
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\\]^\\\`{|}~])/g, '\\\\$1');
  }

  function buildSelector(el) {
    const href = el.getAttribute('href');
    if (href && /^#/.test(href)) {
      const tag = el.tagName.toLowerCase();
      return tag + '[href="' + href.replace(/"/g, '\\\\"') + '"]';
    }
    if (el.id) return '#' + cssEscape(el.id);
    const tag = el.tagName.toLowerCase();
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean) : [];
    // Prefer distinctive BEM modifiers (button--credit, trade-in, button--form) over generic .button
    const distinctive = cls.filter((token) =>
      /^(button--|btn--|offer__|callback|trade-?in|credit|modal-|js-|is-)/i.test(token)
      || /--(credit|callback|trade|info|form|primary|success|order)/i.test(token)
    );
    for (const token of distinctive) {
      const candidate = tag + '.' + cssEscape(token);
      if (document.querySelectorAll(candidate).length >= 1 && document.querySelectorAll(candidate).length <= 8) {
        // Prefer unique; otherwise keep if small set (card may repeat CTAs)
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      }
    }
    if (distinctive.length >= 2) {
      const candidate = tag + '.' + distinctive.slice(0, 2).map(cssEscape).join('.');
      if (document.querySelectorAll(candidate).length >= 1) return candidate;
    }
    if (distinctive.length === 1) {
      return tag + '.' + cssEscape(distinctive[0]);
    }
    for (const token of cls) {
      if (/^(button|btn|link)$/i.test(token)) continue;
      const candidate = tag + '.' + cssEscape(token);
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    }
    if (cls.includes('button') || cls.includes('btn')) {
      const base = cls.includes('button') ? 'button' : 'btn';
      const text = elementText(el).replace(/\\s+/g, ' ').slice(0, 48);
      if (text) return tag + '.' + base + ':has-text("' + text.replace(/"/g, '\\\\"') + '")';
    }
    const text = elementText(el).replace(/\\s+/g, ' ').slice(0, 48);
    if (text) return tag + ':has-text("' + text.replace(/"/g, '\\\\"') + '")';
    return null;
  }

  function rankEntry(text, href, fixed) {
    if (/заказать\\s+звонок/i.test(text)) return 100;
    if (/обратн(?:ый|ого)?\\s+звонок|перезвон/i.test(text)) return 98;
    if (/получить\\s+(?:лучшее\\s+)?предложение|персональное\\s+предложение/i.test(text)) return 96;
    if (/купить\\s+в\\s+кредит|оформить\\s+кредит|получить\\s+скидк/i.test(text)) return 95;
    if (/обменять\\s+по\\s+trade-?in|обменять\\s+по\\s+трейд|заявка\\s+на\\s+trade|trade-?in|трейд-?ин/i.test(text)) return 94;
    if (/получить\\s+цену|узнать\\s+стоимость/i.test(text)) return 93;
    if (/записаться\\s+на\\s+тест|тест[\\s-]?драйв/i.test(text)) return 94;
    if (/рас\S{0,4}читать\s+кредит/i.test(text)) return 92;
    if (/оставить\\s+заявк|обратн\\s+связь/i.test(text)) return 90;
    if (/^купить$|^подробнее$/i.test(String(text || '').trim())) return 50;
    if (CALLBACK_RE.test(text)) return 85;
    if (href && HASH_WIDGET_RE.test(href)) return 88;
    if (href && /^#/.test(href)) return 75;
    if (fixed && STICKY_RE.test(text)) return 82;
    if (SERVICE_RE.test(text)) return 20;
    // Plain nav labels like «Автокредит» / «Trade-in» that point at real pages — low priority
    if (href && /^(?:https?:|\\/)/i.test(href) && !/^#/.test(href)) return 15;
    return 55;
  }

  const seen = new Set();
  const results = [];
  const nodes = document.querySelectorAll('button, a, [role="button"], [onclick], [data-toggle], [data-fancybox], [data-modal], [data-bs-toggle="modal"], div.button, div.btn, div[role="button"], span[role="button"], span.btn, span.button');

  for (const el of nodes) {
    if (!isVisible(el)) continue;
    const text = elementText(el);
    const href = el.getAttribute('href');
    const fixed = isFixedOrSticky(el);
    const hashWidget = href && HASH_WIDGET_RE.test(href);
    const stickyHit = fixed && text && STICKY_RE.test(text);
    if (!hashWidget && !stickyHit && (!text || !PATTERN.test(text))) continue;
    const selector = buildSelector(el);
    if (!selector || seen.has(selector)) continue;
    seen.add(selector);
    results.push({ selector, text: (text || href || '').slice(0, 80), href, priority: rankEntry(text || '', href, fixed) });
  }

  return results.sort((left, right) => right.priority - left.priority);
})()`;

function isLeadPhoneSelector(selector: string): boolean {
  return /data-type=["']?PHONE|type=["']?tel|inputmode=["']?tel|#phone\b|name=["'][^"']*phone|name=["']tel|phone_num|телефон|placeholder.*тел|\+7/i.test(selector)
    && !/#vin\b|#year\b|#email\b|name=["'][^"']*(vin|year|email)/i.test(selector);
}

function isLeadQualityForm(form: DetectedFormMapping): boolean {
  return form.confidence >= MIN_FORM_SCORE && isLeadPhoneSelector(form.phone_selector);
}

export function buildIframeSelector(frameUrl: string): string | null {
  if (!frameUrl || frameUrl.startsWith('about:') || frameUrl === 'about:blank') {
    return null;
  }

  try {
    const parsed = new URL(frameUrl);
    const host = parsed.hostname.replace(/^www\./, '');

    if (!host || host === 'localhost') {
      return null;
    }

    if (host.includes('smartcaptcha') || host.includes('captcha')) {
      return null;
    }

    if (frameUrl.includes('konget') || frameUrl.includes('callkeeper')) {
      return 'iframe[src*="konget"], iframe[src*="callkeeper"]';
    }

    return `iframe[src*="${host}"]`;
  } catch {
    return null;
  }
}

function toDetectedForm(
  raw: RawDetectedForm,
  sourceUrl: string,
  openModalSelector: string | null,
  iframeSelector: string | null,
): DetectedFormMapping | null {
  if (raw.score < MIN_FORM_SCORE) {
    return null;
  }

  if (!isLeadPhoneSelector(raw.phoneSelector) && raw.score < 80) {
    return null;
  }

  return {
    source_url: sourceUrl,
    name_selector: raw.nameSelector,
    phone_selector: raw.phoneSelector,
    submit_selector: raw.submitSelector,
    consent_checkbox_selector: raw.consentCheckboxSelectors[0] ?? null,
    consent_checkbox_selectors: raw.consentCheckboxSelectors,
    form_scope_selector: raw.formScopeSelector,
    open_modal_selector: openModalSelector,
    iframe_selector: iframeSelector,
    confidence: raw.score,
    fingerprint: `${sourceUrl}|modal:${openModalSelector ?? 'inline'}|iframe:${iframeSelector ?? 'main'}|${raw.fingerprint}`,
  };
}

async function waitForModalDom(page: Page, entryHref: string | null): Promise<void> {
  const isHashWidget = Boolean(entryHref && HASH_WIDGET_HREF_PATTERN.test(entryHref));
  const baseWaitMs = isHashWidget ? 2500 : 800;
  await page.waitForTimeout(baseWaitMs);

  await resolveOpenModalShell(page, 8000).catch(() => undefined);

  const modalSelector = [...MODAL_CONTAINER_SELECTORS, OPEN_MODAL_SHELL_SELECTOR].join(', ');

  await Promise.race([
    page.waitForSelector(modalSelector, { state: 'visible', timeout: 4000 }).catch(() => undefined),
    page.waitForSelector(
      [
        '.base-dialog input[type="tel"]',
        '.base-dialog #phone',
        '.base-dialog input[name="tel"]',
        '[role="dialog"] input[type="tel"]',
        'form.form--modal input',
        'form.modal__form input',
        '.modal__wrapper input[type="tel"]',
        '.modal__content input[type="tel"]',
        '.modal__wrapper input[placeholder*="елефон" i]',
        '.modal__content input[placeholder*="елефон" i]',
      ].join(', '),
      { state: 'visible', timeout: 4000 },
    ).catch(() => undefined),
  ]);

  if (isHashWidget) {
    const deadline = Date.now() + 4000;

    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        if (frame.url().includes('konget') || frame.url().includes('callkeeper')) {
          const count = await frame.locator('input').count().catch(() => 0);

          if (count > 0) {
            return;
          }
        }
      }

      await page.waitForTimeout(500);
    }
  }
}

/**
 * Collect forms ONLY inside the currently open modal — never page forms behind the overlay.
 */
async function collectFormsFromOpenModal(
  page: Page,
  sourceUrl: string,
  openModalSelector: string,
): Promise<DetectedFormMapping[]> {
  const shell = await resolveOpenModalShell(page, 10000).catch(() => null);

  if (!shell) {
    return [];
  }

  const raw = await shell.evaluate((modalRoot) => {
    const MIN_FORM_SCORE = 70;
    const SCORE_PHONE = 50;
    const SCORE_NAME = 20;
    const SCORE_SUBMIT = 30;
    const SCORE_CHECKBOXES = 10;
    const PHONE_PLACEHOLDER_RE =
      /ваш\s+номер\s+телефона|номер\s+телефона|ваш\s+телефон|телефон\*?|\+7|8\s*\(|_{2,}|\(\s*_{2,}|\+\s*7/i;
    const NAME_PLACEHOLDER_RE =
      /ваше\s+имя|введите\s+имя|^имя\*?$|(?:^|[\s:])имя(?:\s|\*|$)|\bимя\b|ф\.?\s*и\.?\s*о\.?|фио|fio|first\s*name|your\s+name|фамил|отчество/i;
    const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset', 'password', 'email', 'number', 'range', 'date', 'color']);
    const NON_LEAD_PHONE_RE = /\b(vin|year|email|mileage|пробег|год|инн)\b/i;
    const SUBMIT_TEXT_RE =
      /отправ|заказ|позвон|перезвон|submit|send|заявк|получить|оставить|узнать|запис|консульт|связ|отправить|перезвоните|call|оформ|звонок|написать|свяж|заказать|купить|расчёт|расчет|кредит|предложен/i;

    function cssEscape(value: string): string {
      if (window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(value);
      }

      return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
    }

    function cssEscapeAttribute(value: string): string {
      return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function isStableElementId(id: string): boolean {
      if (!id || id.length > 64 || id.includes(':') || /^\d/.test(id)) {
        return false;
      }

      return /^[A-Za-z][\w-]*$/.test(id);
    }

    function isVisible(element: Element): boolean {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const style = window.getComputedStyle(element);

      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return false;
      }

      const rect = element.getBoundingClientRect();

      return rect.width > 0 && rect.height > 0;
    }

    function nearbyFieldLabel(input: HTMLElement): string {
      const wrap = input.closest('.form__field, .form-field, .field, .input, .form-group, .UITextField, [class*="field"]')
        ?? input.parentElement;
      if (!wrap) {
        return '';
      }

      const labelEl = wrap.querySelector(
        'label, .label, .form__label, .placeholder, .placeholder-content, [class*="label"], [class*="placeholder"]',
      );
      if (labelEl && !labelEl.contains(input)) {
        return (labelEl.textContent || '').trim().slice(0, 120);
      }

      for (const sibling of [input.nextElementSibling, input.previousElementSibling]) {
        if (!sibling || sibling instanceof HTMLInputElement) {
          continue;
        }

        const text = (sibling.textContent || '').trim();
        if (text) {
          return text.slice(0, 120);
        }
      }

      return '';
    }

    function inputContext(input: HTMLInputElement | HTMLTextAreaElement): string {
      const label = input.id
        ? document.querySelector(`label[for="${cssEscapeAttribute(input.id)}"]`)?.textContent?.trim() ?? ''
        : '';
      const parentLabel = input.closest('label')?.textContent?.trim() ?? '';

      return [
        label,
        parentLabel,
        nearbyFieldLabel(input),
        input.getAttribute('aria-label') ?? '',
        input.getAttribute('placeholder') ?? '',
        input.getAttribute('title') ?? '',
        input.getAttribute('name') ?? '',
        input.getAttribute('autocomplete') ?? '',
        input.getAttribute('data-type') ?? '',
      ].join(' ').replace(/\s+/g, ' ').trim();
    }

    function isPhoneField(input: HTMLInputElement): boolean {
      const context = inputContext(input);

      if (NON_LEAD_PHONE_RE.test(context)) {
        return false;
      }

      const dataType = (input.getAttribute('data-type') || '').toUpperCase();

      if (dataType === 'PHONE' || dataType === 'TEL') {
        return true;
      }

      const type = (input.getAttribute('type') || 'text').toLowerCase();
      const inputMode = (input.getAttribute('inputmode') || '').toLowerCase();
      const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
      const name = (input.getAttribute('name') || '').trim();
      const id = (input.id || '').trim();
      const placeholder = (input.getAttribute('placeholder') || '').trim();

      if (type === 'tel' || inputMode === 'tel' || autocomplete === 'tel' || autocomplete === 'tel-national') {
        return true;
      }

      if (/(?:^|[_-])(phone|tel|mobile|телефон)(?:$|[_-])/i.test(name) || /^(phone|tel)$/i.test(id) || /(phone|tel|telephone|mobile)$/i.test(id)) {
        return true;
      }

      return PHONE_PLACEHOLDER_RE.test(placeholder) || PHONE_PLACEHOLDER_RE.test(context);
    }

    function isNameField(input: HTMLInputElement): boolean {
      const type = (input.getAttribute('type') || 'text').toLowerCase();

      if (SKIP_INPUT_TYPES.has(type) || type === 'tel' || type === 'email' || isPhoneField(input)) {
        return false;
      }

      const dataType = (input.getAttribute('data-type') || '').toUpperCase();

      if (dataType === 'NAME' || dataType === 'FIO') {
        return true;
      }

      const name = (input.getAttribute('name') || '').trim();
      const id = (input.id || '').trim();

      if (/^name$/i.test(name) || /(?:^|[_-])(name|fio|имя)(?:$|[_-])/i.test(name) || /(name|fio|firstname|first_name)$/i.test(id)) {
        return true;
      }

      const placeholder = (input.getAttribute('placeholder') || '').trim();
      const context = inputContext(input);

      return NAME_PLACEHOLDER_RE.test(placeholder) || NAME_PLACEHOLDER_RE.test(context);
    }

    function isOptionalVehicleField(input: HTMLInputElement): boolean {
      const context = inputContext(input);
      const placeholder = (input.getAttribute('placeholder') || '').trim();

      return /марка|бренд|brand|модель|model|год|year|кпп|коробк|transmission|пробег|mileage/i.test(
        `${context} ${placeholder}`,
      );
    }

    function fieldLooksRequired(node: Element): boolean {
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
        if (node.required || node.getAttribute('aria-required') === 'true') {
          return true;
        }
      }

      const context = node instanceof HTMLInputElement
        ? inputContext(node)
        : `${node.textContent || ''} ${node.getAttribute('aria-label') || ''}`.replace(/\s+/g, ' ').trim();

      return /\*/.test(context) || /обязательн/i.test(context);
    }

    function isAllowedLeadField(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean {
      if (input instanceof HTMLInputElement) {
        const type = (input.getAttribute('type') || 'text').toLowerCase();

        if (type === 'hidden' || type === 'checkbox' || type === 'radio' || type === 'submit' || type === 'button' || type === 'reset' || type === 'image' || type === 'range') {
          return true;
        }

        if (input.readOnly || /irs-hidden|range-/i.test(input.className || '')) {
          return true;
        }

        if (isPhoneField(input) || isNameField(input)) {
          return true;
        }

        // Trade-in modals often have optional brand/model/year text fields beside phone.
        if ((type === 'text' || type === '') && isOptionalVehicleField(input) && !fieldLooksRequired(input)) {
          return true;
        }

        if (!isVisible(input)) {
          return true;
        }

        const context = inputContext(input);

        if (/honeypot|допфио|anti.?spam|bot.?field/i.test(context)) {
          return true;
        }

        return false;
      }

      if (input instanceof HTMLTextAreaElement) {
        if (!isVisible(input)) {
          return true;
        }

        const context = inputContext(input);

        return /комментар|сообщен|message|note/i.test(context);
      }

      if (input instanceof HTMLSelectElement) {
        if (!isVisible(input)) {
          return true;
        }

        const context = [
          input.getAttribute('name') || '',
          input.getAttribute('id') || '',
          inputContext(input as unknown as HTMLInputElement),
          [...input.options].slice(0, 5).map((opt) => opt.textContent || '').join(' '),
        ].join(' ');

        if (/перезвон|когда\s+звон|время\s+звон|удобн\w*\s+врем|call.?time|callback.?time/i.test(context)) {
          return true;
        }

        // Trade-in: optional year / gearbox selects next to phone.
        if (/год|year|кпп|коробк|transmission|марка|модель|brand|model/i.test(context) && !fieldLooksRequired(input)) {
          return true;
        }

        return false;
      }

      return false;
    }

    function hasDisqualifyingExtraFields(root: Element): boolean {
      const carPicker = root.querySelector(
        '[class*="car-select"], [class*="select-car"], [class*="pick-car"], [data-car], [data-vehicle], select[name*="car"], select[name*="model"]',
      );

      if (carPicker && isVisible(carPicker)) {
        return true;
      }

      const controlWithCar = [...root.querySelectorAll('button, label, select, [role="button"], .form__field, [class*="field"]')]
        .some((el) => /выбрать\s+автомобил|выбор\s+автомобил|укажите\s+автомобил|выберите\s+(авто|машин|модель)/i.test(el.textContent || ''));

      if (controlWithCar) {
        return true;
      }

      for (const node of root.querySelectorAll('input, textarea, select')) {
        if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement)) {
          continue;
        }

        if (node instanceof HTMLInputElement) {
          const type = (node.getAttribute('type') || 'text').toLowerCase();

          if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset' || type === 'image' || type === 'checkbox' || type === 'radio' || type === 'range') {
            continue;
          }
        }

        if (!isVisible(node) && !(node instanceof HTMLSelectElement && node.required)) {
          continue;
        }

        if (isAllowedLeadField(node)) {
          continue;
        }

        const context = node instanceof HTMLInputElement
          ? inputContext(node)
          : `${(node as HTMLElement).getAttribute('name') || ''} ${(node as HTMLElement).getAttribute('placeholder') || ''} ${node.textContent || ''}`.replace(/\s+/g, ' ');

        const looksBusinessField =
          /(?:^|[_-\s])(email|почт|город|city|адрес|address|авто|машин|модель|model|car|марка|brand|vin|пробег|год|year|время|date|дат[аы]|прибыт|визит|офис|салон|комментар|message)(?:$|[_-\s])/i.test(context)
          || (node instanceof HTMLSelectElement)
          || (node instanceof HTMLInputElement && (node.getAttribute('type') || '').toLowerCase() === 'email');

        if (fieldLooksRequired(node) || looksBusinessField) {
          return true;
        }

        if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
          return true;
        }
      }

      return false;
    }

    function buildInputSelector(input: HTMLInputElement): string | null {
      if (input.id && isStableElementId(input.id) && /^(phone|tel|telephone|mobile|name|fio)$/i.test(input.id)) {
        return `#${cssEscape(input.id)}`;
      }

      const dataType = input.getAttribute('data-type');

      if (dataType) {
        return `input[data-type="${cssEscapeAttribute(dataType)}"]`;
      }

      const name = input.getAttribute('name');

      if (name) {
        return `input[name="${cssEscapeAttribute(name)}"]`;
      }

      if (input.id && isStableElementId(input.id)) {
        return `#${cssEscape(input.id)}`;
      }

      const type = (input.getAttribute('type') || 'text').toLowerCase();
      const placeholder = (input.getAttribute('placeholder') || '').trim();

      // Vue/dealer modals often have empty name= — bind by placeholder (ФИО / Телефон).
      if (placeholder) {
        const shortPh = placeholder.slice(0, 32);

        if (PHONE_PLACEHOLDER_RE.test(placeholder) || type === 'tel') {
          return `input[placeholder*="${cssEscapeAttribute(shortPh)}"]`;
        }

        if (NAME_PLACEHOLDER_RE.test(placeholder)) {
          return `input[placeholder*="${cssEscapeAttribute(shortPh)}"]`;
        }
      }

      if (type === 'tel') {
        return 'input[type="tel"]';
      }

      return null;
    }

    function buildSubmitSelector(button: HTMLElement): string {
      const tag = button.tagName.toLowerCase();
      const dataSubmit = button.getAttribute('data-submit');

      if (dataSubmit) {
        return `${tag}[data-submit="${cssEscapeAttribute(dataSubmit)}"]`;
      }

      if (button.id && isStableElementId(button.id)) {
        return `#${cssEscape(button.id)}`;
      }

      // Prefer class / text — CSS [type="submit"] misses <button> without type attr.
      const typeAttr = (button.getAttribute('type') || '').toLowerCase();
      const classTokens = typeof button.className === 'string'
        ? button.className.trim().split(/\s+/).filter((token) => token.length > 1 && token.length < 40)
        : [];
      const preferredClass =
        classTokens.find((token) => /^(button--form|form__btn|btn-submit|button--success)$/i.test(token))
        ?? classTokens.find((token) => /form__btn|button--form|btn-submit|callback|submit|button--success/i.test(token))
        ?? classTokens.find((token) => /^(button|btn)$/i.test(token));

      if (preferredClass) {
        return `${tag}.${cssEscape(preferredClass)}`;
      }

      const text = (button.textContent || (button as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim();

      if (text.length > 0 && text.length <= 48) {
        return `${tag}:has-text("${text.replace(/"/g, '\\"')}")`;
      }

      if (typeAttr === 'submit') {
        return tag === 'input' ? 'input[type="submit"]' : 'button[type="submit"]';
      }

      if (classTokens.length > 0) {
        return `${tag}.${cssEscape(classTokens[0])}`;
      }

      return 'button[type="submit"], button.button--form, button.form__btn, button.btn, a.button, a.btn';
    }

    function isButtonLikeAnchor(node: Element): boolean {
      if (!(node instanceof HTMLAnchorElement)) {
        return false;
      }

      const cls = typeof node.className === 'string' ? node.className : '';
      const role = (node.getAttribute('role') || '').toLowerCase();

      return role === 'button'
        || /\b(btn|button|button--|cta|submit)\b/i.test(cls)
        || Boolean(node.closest('form'));
    }

    function findSubmitButton(root: Element): HTMLElement | null {
      for (const node of root.querySelectorAll(
        'button[type="submit"], input[type="submit"], button[data-submit], button.button--form, button.form__btn, button.btn, button, a.btn, a.button, a[class*="button"], div.button, div.btn, div[role="button"], span.button, span.btn, [role="button"]',
      )) {
        if (
          !(
            node instanceof HTMLButtonElement
            || node instanceof HTMLInputElement
            || node instanceof HTMLAnchorElement
            || node instanceof HTMLDivElement
            || node instanceof HTMLSpanElement
          )
          || !isVisible(node)
        ) {
          continue;
        }

        if (node instanceof HTMLAnchorElement && !isButtonLikeAnchor(node)) {
          continue;
        }

        const typeAttr = (node.getAttribute('type') || '').toLowerCase();
        const isNativeSubmit =
          node.matches('button[type="submit"], input[type="submit"], button[data-submit]')
          || (node instanceof HTMLButtonElement
            && typeAttr !== 'button'
            && typeAttr !== 'reset'
            && Boolean(node.closest('form')));

        if (isNativeSubmit) {
          return node;
        }

        const cls = typeof (node as HTMLElement).className === 'string' ? (node as HTMLElement).className : '';
        if (/button--form|form__btn|btn-submit/i.test(cls) && /button|btn/i.test(cls)) {
          return node as HTMLElement;
        }

        const text = `${node.textContent || ''} ${(node as HTMLInputElement).value || ''} ${node.getAttribute('aria-label') || ''}`.trim();

        if (SUBMIT_TEXT_RE.test(text)) {
          return node as HTMLElement;
        }
      }

      return null;
    }

    function buildScope(form: HTMLFormElement): string {
      const classTokens = typeof form.className === 'string' ? form.className.trim().split(/\s+/).filter(Boolean) : [];
      const preferred = classTokens.filter((token) => /modal|form--|__form|callback|offer|credit|contact/i.test(token));

      for (const token of preferred) {
        const candidate = `form.${cssEscape(token)}`;

        if (modalRoot.querySelectorAll(candidate).length === 1) {
          return candidate;
        }
      }

      if (preferred.length >= 2) {
        return `form.${cssEscape(preferred[0])}.${cssEscape(preferred[1])}`;
      }

      if (preferred.length === 1) {
        return `form.${cssEscape(preferred[0])}`;
      }

      return 'form';
    }

    function buildFormlessScope(root: Element): string {
      if (!(root instanceof HTMLElement)) {
        return '.modal__wrapper, .modal__content, [role="dialog"]';
      }

      const classTokens = typeof root.className === 'string'
        ? root.className.trim().split(/\s+/).filter((token) => token.length > 1 && token.length < 48)
        : [];
      const preferred =
        classTokens.find((token) => /modal__wrapper|modal__content|modal--/i.test(token))
        ?? classTokens.find((token) => /modal|dialog|popup|form/i.test(token));

      if (preferred) {
        return `.${cssEscape(preferred)}`;
      }

      return '.modal__wrapper, .modal__content, .base-dialog, [role="dialog"]';
    }

    function buildCheckboxSelector(checkbox: HTMLInputElement): string {
      const name = checkbox.getAttribute('name');

      if (name) {
        return `input[name="${cssEscapeAttribute(name)}"][type="checkbox"]`;
      }

      if (checkbox.closest('.form__agreement, label.base-checkbox, .base-checkbox')) {
        return '.form__agreement input[type="checkbox"], label.base-checkbox input[type="checkbox"], .base-checkbox input[type="checkbox"]';
      }

      return 'input[type="checkbox"]';
    }

    const results: RawDetectedForm[] = [];
    const roots: Element[] = [...modalRoot.querySelectorAll('form')];

    if (roots.length === 0) {
      roots.push(modalRoot);
    }

    for (const root of roots) {
      if (hasDisqualifyingExtraFields(root)) {
        continue;
      }

      const inputs = [...root.querySelectorAll('input')].filter(
        (el): el is HTMLInputElement => el instanceof HTMLInputElement && isVisible(el),
      );
      const phoneInput = inputs.find((input) => isPhoneField(input));

      if (!phoneInput) {
        continue;
      }

      const submitButton = findSubmitButton(root);

      if (!submitButton) {
        continue;
      }

      const nameInput = inputs.find((input) => input !== phoneInput && isNameField(input)) ?? null;
      const checkboxes = [...root.querySelectorAll('input[type="checkbox"]')].filter(
        (el): el is HTMLInputElement => el instanceof HTMLInputElement && isVisible(el),
      );
      const phoneSelector = buildInputSelector(phoneInput);

      if (!phoneSelector) {
        continue;
      }

      let score = SCORE_PHONE + SCORE_SUBMIT;

      if (nameInput) {
        score += SCORE_NAME;
      }

      if (checkboxes.length > 0) {
        score += SCORE_CHECKBOXES;
      }

      if (score < MIN_FORM_SCORE) {
        continue;
      }

      const formScopeSelector = root instanceof HTMLFormElement
        ? buildScope(root)
        : buildFormlessScope(root);

      results.push({
        formScopeSelector,
        nameSelector: nameInput ? buildInputSelector(nameInput) : null,
        phoneSelector,
        submitSelector: buildSubmitSelector(submitButton),
        consentCheckboxSelectors: checkboxes.map((checkbox) => buildCheckboxSelector(checkbox)),
        fingerprint: `${formScopeSelector}|${phoneSelector}|modal-only`,
        score,
      });
    }

    return results;
  });

  return raw
    .map((form) => toDetectedForm(form, sourceUrl, openModalSelector, null))
    .filter((form): form is DetectedFormMapping => form !== null)
    .sort((left, right) => right.confidence - left.confidence);
}

export async function findEntryPoints(page: Page): Promise<EntryPoint[]> {
  return page.evaluate(ENTRY_POINT_EVALUATOR) as Promise<EntryPoint[]>;
}

function isNavigationalEntryHref(href: string | null): boolean {
  if (!href) {
    return false;
  }

  const trimmed = href.trim();

  if (!trimmed || trimmed === '#' || /^#(.*)/.test(trimmed) || /^(javascript:|tel:|mailto:|sms:)/i.test(trimmed)) {
    return false;
  }

  // Real same-site paths (/credit, /exchange) or absolute URLs — clicking navigates away.
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('?')) {
    return true;
  }

  return false;
}

export async function discoverFormsViaModals(
  page: Page,
  sourceUrl: string,
  options?: { maxTriggers?: number },
): Promise<{ forms: DetectedFormMapping[]; triggersTried: number; entryPointsFound: number }> {
  const maxTriggers = options?.maxTriggers ?? MAX_MODAL_TRIGGERS_PER_PAGE;
  const entryPoints = (await findEntryPoints(page)).filter((entry) => {
    if (entry.text === 'Записаться' && entry.href === '/service/') {
      return false;
    }

    // Nav «Автокредит» → /credit and «Trade-in» → /exchange open pages, not modals.
    // Prefer on-page CTAs (div.button «Купить в кредит») that open modal shells.
    if (isNavigationalEntryHref(entry.href)) {
      return false;
    }

    return true;
  });

  const forms: DetectedFormMapping[] = [];
  const seenFingerprints = new Set<string>();
  let triggersTried = 0;

  for (const entry of entryPoints.slice(0, maxTriggers)) {
    const beforeUrl = page.url();
    const trigger = page.locator(entry.selector).filter({ visible: true }).first();

    if ((await trigger.count()) === 0) {
      continue;
    }

    triggersTried += 1;

    await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
    await trigger.click({ timeout: 5000 }).catch(() => undefined);
    await waitForModalDom(page, entry.href);

    const afterUrl = page.url();
    const effectiveSourceUrl = afterUrl !== beforeUrl ? afterUrl : sourceUrl;

    // CRITICAL: only forms inside the open modal — never footer/page forms behind overlay.
    let detected: DetectedFormMapping[] = [];
    try {
      detected = await collectFormsFromOpenModal(page, effectiveSourceUrl, entry.selector);
    } catch (error) {
      // Keep scanning other triggers; surface reason in Node logs when debugging.
      if (process.env.BOT_DEBUG_MODAL === '1') {
        console.warn('[modal-discover]', entry.selector, error);
      }
      detected = [];
    }

    for (const form of detected) {
      if (seenFingerprints.has(form.fingerprint)) {
        continue;
      }

      seenFingerprints.add(form.fingerprint);
      forms.push(form);
    }

    if (afterUrl !== beforeUrl) {
      await page.goto(beforeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => undefined);
      await page.waitForTimeout(800);
    } else {
      await closeOpenModal(page);
    }
  }

  return { forms, triggersTried, entryPointsFound: entryPoints.length };
}

export { isLeadQualityForm };
