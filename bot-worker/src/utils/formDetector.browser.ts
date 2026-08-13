/**
 * Browser-side form detection. Evaluated inside Playwright page context.
 * Must stay self-contained (no imports) — Playwright serializes this function.
 *
 * Finds lead forms in:
 * - visible <form>
 * - modal/dialog/callback containers without <form>
 * Phone: type=tel, inputmode=tel, name/placeholder/data-type, text fields that look like phone.
 */

export type RawDetectedForm = {
  formScopeSelector: string | null;
  nameSelector: string | null;
  firstNameSelector: string | null;
  lastNameSelector: string | null;
  emailSelector: string | null;
  selectSelectors: string[];
  phoneSelector: string;
  submitSelector: string;
  consentCheckboxSelectors: string[];
  fingerprint: string;
  score: number;
};

export type FormDetectionResult = {
  phonesSeen: number;
  formsScanned: number;
  forms: RawDetectedForm[];
};

export function collectFormsInDocument(): FormDetectionResult {
  const MIN_FORM_SCORE = 70;
  const SCORE_PHONE = 50;
  const SCORE_NAME = 20;
  const SCORE_SUBMIT = 30;
  const SCORE_CHECKBOXES = 10;
  const SCORE_EMAIL = 10;
  const SCORE_TEXTAREA = 5;
  const SCORE_AUTH_PENALTY = -100;

  const PHONE_PLACEHOLDER_RE =
    /ваш\s+номер\s+телефона|номер\s+телефона|ваш\s+телефон|телефон\*?|phone|\+7(?:\s|\(|_)|8\s*\(\s*_|\+\s*7/i;
  const PHONE_NAME_RE =
    /(?:^|[_-])(phone|tel|mobile|telefon|телефон|телефончик|phone_num|phonenumber)(?:$|[_-])/i;
  // Site builders (e.g. mary{hash}phone / mary{hash}name) — id ends with field role.
  const PHONE_ID_SUFFIX_RE = /(phone|tel|telephone|mobile|telefon)$/i;
  const NAME_ID_SUFFIX_RE = /(name|fio|firstname|first_name)$/i;
  const FIRST_NAME_RE =
    /(?:^|[_-\s])(first.?name|firstname|given.?name|имя)(?:$|[_-\s*])|^имя\*?$|ваше\s+имя|введите\s+имя/i;
  const LAST_NAME_RE =
    /(?:^|[_-\s])(last.?name|lastname|family.?name|surname|фамил)(?:$|[_-\s*])|^фамил\w*\*?$|ваша\s+фамил/i;
  const FIO_NAME_RE =
    /ф\.?\s*и\.?\s*о\.?|\bfio\b|полное\s+имя|your\s+name/i;
  const NAME_PLACEHOLDER_RE =
    /ваше\s+имя|введите\s+имя|^имя\*?$|(?:^|[\s:])имя(?:\s|\*|$)|\bимя\b|ф\.?\s*и\.?\s*о\.?|фио|fio|first\s*name|your\s+name|фамил|отчество/i;
  const EMAIL_FIELD_RE = /e-?mail|почта|электронн\w*\s+почт/i;
  const FILLABLE_SELECT_RE =
    /дилер|dealer|модель|model|авто|машин|салон|офис|город|city|когда|перезвон|время|call.?time|марка|brand/i;
  const AUTH_FORM_RE =
    /(?:^|[\s>])(войти|вход|логин|password|пароль|sign\s*in|log\s*in|авторизац|регистрац)/i;
  const PHONE_CLASS_RE = /\b(phone|tel|telefon|телефон|phone-input|input-phone)\b/i;
  const NAME_CLASS_RE = /\b(name|fio|имя|name-input|input-name)\b/i;
  const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset', 'password', 'email', 'number', 'range', 'date', 'color']);
  const NON_LEAD_PHONE_RE = /\b(vin|year|email|mileage|пробег|год|инн)\b/i;
  const SUBMIT_TEXT_RE =
    /отправ|заказ|позвон|перезвон|submit|send|заявк|получить|оставить|узнать|запис|консульт|связ|отправить|перезвоните|call|оформ|звонок|написать|свяж|заказать|купить|расчёт|расчет|кредит|предложен/i;
  const CONTAINER_SELECTOR =
    'form, .base-dialog, .base-dialog-overlay, [role="dialog"], .modal, .modal__wrapper, .modal__content, .popup, .dialog, .fancybox-content, .mfp-content, .v-modal, .t-popup, [class*="callback"], [class*="Callback"], [class*="lead-form"], [class*="LeadForm"], [class*="feedback"], [class*="contact-form"], [class*="custom-lead"], [data-form]';

  /** Open Shadow DOM + light DOM query (additive deep walk). */
  function queryAllDeep(root: ParentNode, selector: string): Element[] {
    const results: Element[] = [];

    const visit = (node: ParentNode) => {
      try {
        results.push(...Array.from(node.querySelectorAll(selector)));
      } catch {
        return;
      }

      let elements: Element[] = [];
      try {
        elements = Array.from(node.querySelectorAll('*'));
      } catch {
        return;
      }

      for (const el of elements) {
        if (el.shadowRoot) {
          visit(el.shadowRoot);
        }
      }
    };

    visit(root);
    return results;
  }

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
    if (!id || id.length > 64) {
      return false;
    }

    // Dynamic Vue/React ids, numeric ids, ids with ':' are unstable / invalid CSS.
    if (/^:r[a-z0-9]+/i.test(id) || id.includes(':') || /^\d/.test(id)) {
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

  function semanticClassHint(input: HTMLElement): string {
    let node: HTMLElement | null = input;
    for (let depth = 0; depth < 5 && node; depth += 1) {
      const cls = typeof node.className === 'string' ? node.className : '';
      if (/(?:^|\s)(?:firstname_|lastname_|surname_|phone_|email_|fio_|name_)/i.test(cls)
        || /(?:firstname|lastname|surname|phone|email|fio)(?:_|\b)/i.test(cls)) {
        return cls;
      }
      node = node.parentElement;
    }
    return '';
  }

  function nearbyFieldLabel(input: HTMLElement): string {
    // Prefer the nearest field wrapper — avoid climbing to a parent that wraps name+phone together
    // (e.g. broad [class*="field"] matching the whole form).
    const wrap = input.closest(
      '.form__field, .form-field, .form-group, .UITextField, .t-input-group, .input-group, [class*="form__field"], [class*="FormField"], [class*="field__"], [class*="Field__"], [class*="container__"]',
    ) ?? null;

    if (wrap && wrap !== input.closest('form') && wrap !== document.body) {
      const labeled = readLocalLabel(wrap, input);
      if (labeled && labeled.length <= 48) {
        return labeled;
      }
    }

    // CSS-module dealer forms: label often sits on the immediate field container.
    let node: HTMLElement | null = input.parentElement;
    for (let depth = 0; depth < 3 && node; depth += 1) {
      if (node === input.closest('form') || node === document.body) {
        break;
      }

      const labeled = readLocalLabel(node, input);
      if (labeled && labeled.length <= 40) {
        return labeled;
      }

      const prev = node.previousElementSibling;
      if (prev && !(prev instanceof HTMLInputElement) && !(prev instanceof HTMLTextAreaElement) && !(prev instanceof HTMLSelectElement)) {
        const prevText = (prev.textContent || '').replace(/\s+/g, ' ').trim();
        if (prevText && prevText.length <= 40 && !/соглас|политик|персональн|smartcaptcha|имяфамил/i.test(prevText)) {
          return prevText.slice(0, 120);
        }
      }

      // Stop once we leave a dedicated field container — don't bleed sibling labels.
      if (/field__|Field__|container__|form__field|form-group/i.test(String(node.className || ''))) {
        break;
      }

      node = node.parentElement;
    }

    return '';
  }

  function readLocalLabel(wrap: Element, input: HTMLElement): string {
    const labelEl = wrap.querySelector(
      'label, .label, .form__label, .placeholder, .placeholder-content, [class*="label"], [class*="placeholder"], [class*="Label"]',
    );
    if (labelEl) {
      const text = (labelEl.textContent || '').replace(/\s+/g, ' ').trim();
      // Even when <label> wraps the input, empty controls leave only the caption text.
      if (text && text.length <= 60) {
        return text.slice(0, 120);
      }
    }

    // Fake placeholders rendered as sibling overlays (common on dealer SPAs).
    for (const sibling of [input.nextElementSibling, input.previousElementSibling]) {
      if (!sibling || sibling instanceof HTMLInputElement) {
        continue;
      }

      const text = (sibling.textContent || '').trim();
      if (text && text.length <= 60) {
        return text.slice(0, 120);
      }
    }

    return '';
  }

  function inputContext(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
    const label = input.id
      ? document.querySelector(`label[for="${cssEscapeAttribute(input.id)}"]`)?.textContent?.trim() ?? ''
      : '';
    const parentLabel = input.closest('label')?.textContent?.trim() ?? '';
    const className = typeof (input as HTMLElement).className === 'string'
      ? (input as HTMLElement).className
      : '';

    return [
      label,
      parentLabel,
      nearbyFieldLabel(input as HTMLElement),
      semanticClassHint(input as HTMLElement),
      input.getAttribute('aria-label') ?? '',
      input.getAttribute('placeholder') ?? '',
      input.getAttribute('title') ?? '',
      input.getAttribute('name') ?? '',
      input.getAttribute('autocomplete') ?? '',
      input.getAttribute('inputmode') ?? '',
      input.getAttribute('data-type') ?? '',
      input.getAttribute('data-name') ?? '',
      className,
      input.id ?? '',
    ]
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildSelectSelector(select: HTMLSelectElement): string | null {
    if (select.id && isStableElementId(select.id)) {
      return `#${cssEscape(select.id)}`;
    }

    const name = select.getAttribute('name');
    if (name) {
      return `select[name="${cssEscapeAttribute(name)}"]`;
    }

    const className = typeof select.className === 'string'
      ? select.className.trim().split(/\s+/).find((token) => token.length > 2 && token.length < 40)
      : null;
    if (className) {
      return `select.${cssEscape(className)}`;
    }

    return 'select';
  }

  function buildInputSelector(input: HTMLInputElement): string | null {
    // Prefer stable semantic ids (#phone) before generic name=tel shared across forms.
    if (
      input.id
      && isStableElementId(input.id)
      && (
        /^(phone|tel|telephone|mobile|name|fio|email|firstname|lastname|first_name|last_name)$/i.test(input.id)
        || PHONE_ID_SUFFIX_RE.test(input.id)
        || NAME_ID_SUFFIX_RE.test(input.id)
        || /email|mail$/i.test(input.id)
      )
    ) {
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

    // Name/phone often have no name= attr (Nuxt/Vue) — use placeholder.
    if (placeholder) {
      const shortPh = placeholder.slice(0, 32);

      if (PHONE_PLACEHOLDER_RE.test(placeholder) || type === 'tel') {
        return `input[placeholder*="${cssEscapeAttribute(shortPh)}"]`;
      }

      if (NAME_PLACEHOLDER_RE.test(placeholder) || EMAIL_FIELD_RE.test(placeholder)) {
        return `input[placeholder*="${cssEscapeAttribute(shortPh)}"]`;
      }
    }

    if (type === 'tel') {
      return 'input[type="tel"]';
    }

    if (type === 'email') {
      return 'input[type="email"]';
    }

    const nearby = nearbyFieldLabel(input);
    const formRoot = input.closest('form') ?? input.closest('[class*="form"]') ?? document.body;

    // Name/phone/email without stable attrs — bind by relative path inside the form.
    if ((type === 'text' || type === '' || type === 'search' || type === 'tel' || type === 'email')
      && (NAME_PLACEHOLDER_RE.test(nearby) || PHONE_PLACEHOLDER_RE.test(nearby) || EMAIL_FIELD_RE.test(nearby)
        || semanticClassHint(input) || type === 'tel' || type === 'email')) {
      const relative = buildRelativeCssPath(input, formRoot);
      if (relative) {
        return relative;
      }
    }

    if ((type === 'text' || type === '') && NAME_PLACEHOLDER_RE.test(nearby)) {
      const relative = buildRelativeCssPath(input, formRoot);
      return relative ?? 'input[type="text"]';
    }

    if ((type === 'text' || type === '') && PHONE_PLACEHOLDER_RE.test(nearby)) {
      const relative = buildRelativeCssPath(input, formRoot);
      return relative ?? 'input[type="text"]';
    }

    const inputMode = (input.getAttribute('inputmode') || '').toLowerCase();

    if (inputMode === 'tel' || inputMode === 'numeric' || inputMode === 'decimal') {
      // Many RU dealer sites mark phone as inputmode=numeric without name=.
      if (PHONE_PLACEHOLDER_RE.test(placeholder) || PHONE_PLACEHOLDER_RE.test(inputContext(input))) {
        const relative = buildRelativeCssPath(input, formRoot);
        return relative ?? `input[inputmode="${cssEscapeAttribute(inputMode)}"]`;
      }
    }

    return buildRelativeCssPath(input, formRoot);
  }

  function buildScopeSelector(root: Element, phoneInput: HTMLInputElement): string {
    if (root instanceof HTMLFormElement) {
      const creditWrap = root.closest(
        '.catalog-model--credit-form, [class*="credit-form"], [class*="callback-form"], [class*="lead-form"]',
      );

      if (creditWrap instanceof HTMLElement) {
        const wrapClass = typeof creditWrap.className === 'string'
          ? creditWrap.className.trim().split(/\s+/).find((token) => /credit-form|callback-form|lead-form/i.test(token))
          : null;

        if (wrapClass) {
          const candidate = `.${cssEscape(wrapClass)} form`;

          if (document.querySelectorAll(candidate).length >= 1) {
            return candidate;
          }
        }
      }

      const classTokens = typeof root.className === 'string'
        ? root.className.trim().split(/\s+/).filter(Boolean)
        : [];

      const preferred = classTokens.filter((token) => (
        /^(form--[\w-]+|[\w-]+__form|modal__form)$/i.test(token)
        || /(modal|callback|contact|credit|offer|lead|feedback)/i.test(token)
      ));

      for (const token of preferred) {
        const candidate = `form.${cssEscape(token)}`;

        if (document.querySelectorAll(candidate).length === 1) {
          return candidate;
        }
      }

      if (preferred.length >= 2) {
        const candidate = `form.${cssEscape(preferred[0])}.${cssEscape(preferred[1])}`;

        if (document.querySelectorAll(candidate).length >= 1) {
          return candidate;
        }
      }

      const dataSubmit = root.querySelector('[data-submit]')?.getAttribute('data-submit');

      if (dataSubmit) {
        return `form:has(button[data-submit="${cssEscapeAttribute(dataSubmit)}"]), form:has([data-submit="${cssEscapeAttribute(dataSubmit)}"])`;
      }

      const phoneId = phoneInput.id && isStableElementId(phoneInput.id) ? phoneInput.id : null;

      if (phoneId) {
        const byId = `form:has(#${cssEscape(phoneId)})`;

        if (document.querySelectorAll(byId).length === 1) {
          return byId;
        }
      }

      // Name id is often unique even when phone id is duplicated across modal+inline.
      const nameCandidate = [...root.querySelectorAll('input')].find(
        (el) => el instanceof HTMLInputElement && el !== phoneInput && isNameField(el),
      );
      const nameId = nameCandidate?.id && isStableElementId(nameCandidate.id) ? nameCandidate.id : null;

      if (nameId) {
        const byName = `form:has(#${cssEscape(nameId)})`;

        if (document.querySelectorAll(byName).length === 1) {
          return byName;
        }
      }

      const submitBtn = findSubmitButton(root);
      const submitText = submitBtn
        ? `${submitBtn.textContent || ''} ${(submitBtn as HTMLInputElement).value || ''}`.replace(/\s+/g, ' ').trim()
        : '';

      if (submitBtn && submitText.length >= 4 && submitText.length <= 60) {
        const matchingForms = [...document.querySelectorAll('form')].filter((form) => {
          const style = window.getComputedStyle(form);
          const rect = form.getBoundingClientRect();
          if (style.display === 'none' || style.visibility === 'hidden' || rect.width < 2 || rect.height < 2) {
            return false;
          }

          const candidate = findSubmitButton(form);
          if (!candidate || !isVisible(candidate)) {
            return false;
          }

          const text = `${candidate.textContent || ''} ${(candidate as HTMLInputElement).value || ''}`.replace(/\s+/g, ' ').trim();
          return text === submitText;
        });

        if (matchingForms.length === 1) {
          const tag = submitBtn.tagName.toLowerCase();
          const cls = typeof submitBtn.className === 'string'
            ? submitBtn.className.trim().split(/\s+/).find((token) => /^(button|btn|button--success)$/i.test(token))
            : null;

          if (cls) {
            return `form:has(${tag}.${cssEscape(cls)})`;
          }

          // Playwright-only :has-text — do not validate via document.querySelectorAll.
          return `form:has(${tag}:has-text("${cssEscapeAttribute(submitText)}"))`;
        }
      }

      // Prefer unique phone type scope among visible forms.
      if ((phoneInput.getAttribute('type') || '').toLowerCase() === 'tel') {
        const telForms = [...document.querySelectorAll('form')].filter((form) => {
          const style = window.getComputedStyle(form);
          const rect = form.getBoundingClientRect();
          if (style.display === 'none' || style.visibility === 'hidden' || rect.width < 2 || rect.height < 2) {
            return false;
          }

          return Boolean(form.querySelector('input[type="tel"]'));
        });

        if (telForms.length === 1) {
          return 'form:has(input[type="tel"])';
        }
      }

      const phoneName = phoneInput.getAttribute('name');
      const dataType = phoneInput.getAttribute('data-type');

      if (dataType) {
        return `form:has(input[data-type="${cssEscapeAttribute(dataType)}"])`;
      }

      if (phoneName && preferred.length > 0) {
        return `form.${cssEscape(preferred[0])}:has(input[name="${cssEscapeAttribute(phoneName)}"])`;
      }

      if (phoneName) {
        return `form:has(input[name="${cssEscapeAttribute(phoneName)}"])`;
      }

      const phoneSel = buildInputSelector(phoneInput);

      if (phoneSel) {
        return `form:has(${phoneSel})`;
      }

      return 'form:has(input[type="tel"]), form:has(input[inputmode="tel"])';
    }

    if (root instanceof HTMLElement && root.id && isStableElementId(root.id)) {
      return `#${cssEscape(root.id)}`;
    }

    if (root instanceof HTMLElement) {
      if (root.classList.contains('base-dialog') || root.closest('.base-dialog')) {
        return '.base-dialog form, form.form--modal, form.modal__form';
      }

      const role = root.getAttribute('role');

      if (role === 'dialog') {
        return '[role="dialog"]';
      }

      const cls = typeof root.className === 'string'
        ? root.className.trim().split(/\s+/).filter((token) => token.length > 2 && token.length < 40)
        : [];

      for (const token of cls) {
        const candidate = `${root.tagName.toLowerCase()}.${cssEscape(token)}`;

        if (document.querySelectorAll(candidate).length === 1) {
          return candidate;
        }
      }
    }

    const phoneSel = buildInputSelector(phoneInput);

    return phoneSel ? `:has(${phoneSel})` : 'body';
  }

  function isInsideCustomSelectWidget(el: Element): boolean {
    return Boolean(
      el.closest(
        '[class*="react-select__"], [class*="Select__control"], [class*="Select__value"], [class*="Select__input"], [class*="select__control"], [class*="select__value"]',
      ),
    );
  }

  function isAllowedLeadField(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean {
    if (input instanceof HTMLInputElement) {
      const type = (input.getAttribute('type') || 'text').toLowerCase();

      if (type === 'hidden' || type === 'checkbox' || type === 'radio' || type === 'submit' || type === 'button' || type === 'reset' || type === 'image') {
        return true;
      }

      // Credit calculator / ion.rangeSlider noise.
      if (input.readOnly || /irs-hidden|range-/i.test(input.className || '')) {
        return true;
      }

      // react-select / react-select-like search input inside the control — not a real form field.
      if (isInsideCustomSelectWidget(input)) {
        return true;
      }

      if (isPhoneField(input) || isNameField(input) || isFirstNameField(input) || isLastNameField(input) || isEmailField(input)) {
        return true;
      }

      // Honeypot / invisible decoy fields.
      if (!isVisible(input)) {
        return true;
      }

      const context = inputContext(input);

      if (/honeypot|допфио|anti.?spam|bot.?field|form-spec-comments|tildaspec-elemid/i.test(context)) {
        return true;
      }

      // Tilda / site-builder honeypot decoys (often visually off-screen but still "visible").
      const nameAttr = (input.getAttribute('name') || '').toLowerCase();
      const classAttr = typeof input.className === 'string' ? input.className : '';
      if (/form-spec-comments|js-form-spec-comments|tildaspec-elemid/i.test(`${nameAttr} ${classAttr}`)) {
        return true;
      }

      return false;
    }

    if (input instanceof HTMLTextAreaElement) {
      if (!isVisible(input)) {
        return true;
      }

      const context = inputContext(input);

      // Optional comment is ok only when not marked required — handled by caller.
      return /комментар|сообщен|message|note/i.test(context);
    }

    // select: call-time + dealer/model/city style — we fill randomly.
    if (input instanceof HTMLSelectElement) {
      if (!isVisible(input)) {
        return true;
      }

      const context = [
        input.getAttribute('name') || '',
        input.getAttribute('id') || '',
        inputContext(input as unknown as HTMLInputElement),
        [...input.options].slice(0, 8).map((opt) => opt.textContent || '').join(' '),
      ].join(' ');

      return /перезвон|когда\s+звон|время\s+звон|удобн\w*\s+врем|call.?time|callback.?time/i.test(context)
        || FILLABLE_SELECT_RE.test(context)
        || fieldLooksRequired(input);
    }

    return false;
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

  /**
   * Skip forms that need more than name/phone/email/selects + consent
   * (address, vin, required comment, password, etc.).
   */
  function hasDisqualifyingExtraFields(root: Element): boolean {
    for (const node of root.querySelectorAll('input, textarea, select')) {
      if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement)) {
        continue;
      }

      if (node instanceof HTMLInputElement) {
        const type = (node.getAttribute('type') || 'text').toLowerCase();

        if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset' || type === 'image') {
          continue;
        }

        if (type === 'checkbox' || type === 'radio') {
          continue;
        }

        if (type === 'password') {
          return true;
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

      const looksUnsupported =
        /(?:^|[_-\s])(адрес|address|vin|пробег|инн|паспорт|комментар|message|отзыв)(?:$|[_-\s])/i.test(context)
        || (node instanceof HTMLTextAreaElement && fieldLooksRequired(node));

      if (looksUnsupported && fieldLooksRequired(node)) {
        return true;
      }

      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
        if (node instanceof HTMLInputElement) {
          const type = (node.getAttribute('type') || 'text').toLowerCase();
          if (type === 'email') {
            continue;
          }

          const textInputs = [...root.querySelectorAll('input')].filter((el) => {
            if (!(el instanceof HTMLInputElement) || !isVisible(el)) {
              return false;
            }
            const t = (el.getAttribute('type') || 'text').toLowerCase();
            return t === 'text' || t === 'search' || t === '';
          });
          const phoneCount = textInputs.filter((el) => isPhoneField(el)).length;
          const nameCount = textInputs.filter((el) => isNameField(el) || isFirstNameField(el) || isLastNameField(el)).length;
          const unknownCount = textInputs.length - phoneCount - nameCount;

          if (phoneCount >= 1 && nameCount === 0 && unknownCount === 1) {
            continue;
          }
        }

        if (fieldLooksRequired(node)) {
          return true;
        }

        return true;
      }
    }

    return false;
  }

  function isFirstNameField(input: HTMLInputElement): boolean {
    const type = (input.getAttribute('type') || 'text').toLowerCase();
    if (SKIP_INPUT_TYPES.has(type) || type === 'tel' || type === 'email') {
      return false;
    }
    if (isPhoneField(input) || isEmailField(input)) {
      return false;
    }

    const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
    if (autocomplete === 'given-name') {
      return true;
    }

    const context = inputContext(input);
    const name = (input.getAttribute('name') || '').trim();
    const id = (input.id || '').trim();
    const placeholder = (input.getAttribute('placeholder') || '').trim();

    if (LAST_NAME_RE.test(name) || LAST_NAME_RE.test(id) || LAST_NAME_RE.test(placeholder) || LAST_NAME_RE.test(context)) {
      return false;
    }

    return FIRST_NAME_RE.test(name) || FIRST_NAME_RE.test(id) || FIRST_NAME_RE.test(placeholder) || FIRST_NAME_RE.test(context);
  }

  function isLastNameField(input: HTMLInputElement): boolean {
    const type = (input.getAttribute('type') || 'text').toLowerCase();
    if (SKIP_INPUT_TYPES.has(type) || type === 'tel' || type === 'email') {
      return false;
    }
    if (isPhoneField(input) || isEmailField(input)) {
      return false;
    }

    const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
    if (autocomplete === 'family-name') {
      return true;
    }

    const context = inputContext(input);
    const name = (input.getAttribute('name') || '').trim();
    const id = (input.id || '').trim();
    const placeholder = (input.getAttribute('placeholder') || '').trim();

    return LAST_NAME_RE.test(name) || LAST_NAME_RE.test(id) || LAST_NAME_RE.test(placeholder) || LAST_NAME_RE.test(context);
  }

  function isCombinedNameField(input: HTMLInputElement): boolean {
    if (isFirstNameField(input) || isLastNameField(input)) {
      return false;
    }

    return isNameField(input) || FIO_NAME_RE.test(inputContext(input));
  }

  function buildRelativeCssPath(el: Element, root: Element): string | null {
    if (el === root) {
      return null;
    }

    const parts: string[] = [];
    let node: Element | null = el;

    while (node && node !== root) {
      const parent: Element | null = node.parentElement;
      if (!parent) {
        break;
      }

      const tag = node.tagName.toLowerCase();
      const siblings = [...parent.children].filter((child) => child.tagName === node!.tagName);
      if (siblings.length === 1) {
        parts.unshift(tag);
      } else {
        const index = siblings.indexOf(node) + 1;
        parts.unshift(`${tag}:nth-of-type(${index})`);
      }

      node = parent;
      if (parts.length > 14) {
        break;
      }
    }

    return parts.length > 0 ? parts.join(' > ') : null;
  }

  function buildCustomSelectControlSelector(control: Element, root: Element): string | null {
    if (!(control instanceof HTMLElement)) {
      return null;
    }

    if (control.id && isStableElementId(control.id)) {
      return `#${cssEscape(control.id)}`;
    }

    const relative = buildRelativeCssPath(control, root);
    if (relative) {
      return relative;
    }

    const className = typeof control.className === 'string'
      ? control.className.trim().split(/\s+/).find((token) => /react-select__control|Select__control|select__control/i.test(token))
      : null;

    if (className) {
      return `div.${cssEscape(className)}`;
    }

    return '[class*="react-select__control"], [class*="Select__control"]';
  }

  function collectFillableSelectSelectors(root: Element): string[] {
    const result: string[] = [];
    for (const node of root.querySelectorAll('select')) {
      if (!(node instanceof HTMLSelectElement) || !isVisible(node)) {
        continue;
      }

      const context = [
        node.getAttribute('name') || '',
        node.id || '',
        inputContext(node as unknown as HTMLInputElement),
        [...node.options].slice(0, 8).map((opt) => opt.textContent || '').join(' '),
      ].join(' ');

      if (
        FILLABLE_SELECT_RE.test(context)
        || fieldLooksRequired(node)
        || /перезвон|когда\s+звон|call.?time/i.test(context)
      ) {
        const selector = buildSelectSelector(node);
        if (selector) {
          result.push(selector);
        }
      }
    }

    const customControls = [
      ...root.querySelectorAll(
        '[class*="react-select__control"], [class*="Select__control"], [class*="select__control"]',
      ),
    ].filter((node): node is HTMLElement => node instanceof HTMLElement && isVisible(node));

    for (const control of customControls) {
      // Skip nested duplicates (value-container inside control already matched as control).
      if (control.closest('[class*="react-select__menu"], [class*="Select__menu"]')) {
        continue;
      }

      const context = [
        control.getAttribute('aria-label') || '',
        control.textContent || '',
        nearbyFieldLabel(control),
        control.className || '',
      ].join(' ');

      // Lead forms: any visible custom select (dealer/model/city) is fillable on submit.
      if (
        FILLABLE_SELECT_RE.test(context)
        || /выберите|select|дилер|модель|город/i.test(context)
        || customControls.length <= 4
      ) {
        const selector = buildCustomSelectControlSelector(control, root);
        if (selector) {
          result.push(selector);
        }
      }
    }

    return [...new Set(result)];
  }

  function isNameField(input: HTMLInputElement): boolean {
    const type = (input.getAttribute('type') || 'text').toLowerCase();

    if (SKIP_INPUT_TYPES.has(type) || type === 'tel' || type === 'email' || type === 'search') {
      return false;
    }

    if (isPhoneField(input) || isEmailField(input) || isFirstNameField(input) || isLastNameField(input)) {
      return false;
    }

    const dataType = (input.getAttribute('data-type') || '').toUpperCase();
    const dataName = (input.getAttribute('data-name') || '').toLowerCase();

    if (dataType === 'NAME' || dataType === 'FIO') {
      return true;
    }

    if (/name|fio|имя/.test(dataName)) {
      return true;
    }

    const name = (input.getAttribute('name') || '').trim();
    const id = (input.id || '').trim();
    const className = typeof input.className === 'string' ? input.className : '';

    if (/^name$/i.test(name) || /(?:^|[_-])(name|fio|имя)(?:$|[_-])/i.test(name) || NAME_ID_SUFFIX_RE.test(id) || NAME_CLASS_RE.test(className)) {
      return true;
    }

    // Tilda / builders: name="Name", name="name[]", autocomplete=name (not given/family).
    if (/^name(\[\]|$)/i.test(name) || /^(name)$/i.test((input.getAttribute('autocomplete') || '').trim())) {
      return true;
    }

    const placeholder = (input.getAttribute('placeholder') || '').trim();
    const context = inputContext(input);

    if (FIRST_NAME_RE.test(placeholder) || LAST_NAME_RE.test(placeholder) || FIRST_NAME_RE.test(context) || LAST_NAME_RE.test(context)) {
      return false;
    }

    return NAME_PLACEHOLDER_RE.test(placeholder) || NAME_PLACEHOLDER_RE.test(context) || FIO_NAME_RE.test(context);
  }

  function isPhoneField(input: HTMLInputElement): boolean {
    const dataType = (input.getAttribute('data-type') || '').toUpperCase();
    const dataName = (input.getAttribute('data-name') || '').toLowerCase();

    // Explicit semantic types win — never treat NAME as phone via parent context bleed.
    if (dataType === 'NAME' || dataType === 'FIO' || dataType === 'EMAIL') {
      return false;
    }

    if (dataType === 'PHONE' || dataType === 'TEL') {
      return true;
    }

    if (/name|fio|имя/.test(dataName) && !/phone|tel|telefon|телефон/.test(dataName)) {
      return false;
    }

    if (/phone|tel|telefon|телефон/.test(dataName)) {
      return true;
    }

    const type = (input.getAttribute('type') || 'text').toLowerCase();
    const inputMode = (input.getAttribute('inputmode') || '').toLowerCase();
    const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
    const name = (input.getAttribute('name') || '').trim();
    const id = (input.id || '').trim();
    const placeholder = (input.getAttribute('placeholder') || '').trim();
    const className = typeof input.className === 'string' ? input.className : '';
    const ownBlob = [name, id, placeholder, autocomplete, className].join(' ');

    // Own attributes clearly say "name" — do not promote to phone via parent label text.
    if (NAME_PLACEHOLDER_RE.test(placeholder) || NAME_ID_SUFFIX_RE.test(id) || /(?:^|[_-])(name|fio|имя)(?:$|[_-])/i.test(name)) {
      if (!PHONE_PLACEHOLDER_RE.test(placeholder) && type !== 'tel' && inputMode !== 'tel') {
        return false;
      }
    }

    const context = inputContext(input);

    if (NON_LEAD_PHONE_RE.test(context) || NON_LEAD_PHONE_RE.test(ownBlob)) {
      return false;
    }

    if (type === 'tel' || inputMode === 'tel' || autocomplete === 'tel' || autocomplete === 'tel-national') {
      return true;
    }

    if (PHONE_NAME_RE.test(name) || PHONE_NAME_RE.test(id) || PHONE_ID_SUFFIX_RE.test(id) || PHONE_CLASS_RE.test(className)) {
      return true;
    }

    if (SKIP_INPUT_TYPES.has(type) && type !== 'text' && type !== 'search') {
      return false;
    }

    return PHONE_PLACEHOLDER_RE.test(placeholder) || PHONE_PLACEHOLDER_RE.test(context);
  }

  function isEmailField(input: HTMLInputElement): boolean {
    const type = (input.getAttribute('type') || 'text').toLowerCase();

    if (type === 'email') {
      return true;
    }

    if (isPhoneField(input)) {
      return false;
    }

    const context = inputContext(input);
    const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();

    return autocomplete === 'email' || EMAIL_FIELD_RE.test(context);
  }

  function looksLikeAuthForm(root: Element): boolean {
    if (root.querySelector('input[type="password"]')) {
      return true;
    }

    const text = (root.textContent || '').replace(/\s+/g, ' ').slice(0, 600);

    return AUTH_FORM_RE.test(text) && Boolean(
      root.querySelector('input[type="password"], input[name*="password" i], input[name*="login" i], input[autocomplete="current-password"]'),
    );
  }

  function isDefaultFormSubmit(node: HTMLButtonElement | HTMLInputElement): boolean {
    // CSS button[type="submit"] does NOT match <button> without type attr,
    // but the DOM default for <button> inside <form> is type=submit.
    if (node instanceof HTMLInputElement) {
      return (node.getAttribute('type') || '').toLowerCase() === 'submit';
    }

    const typeAttr = (node.getAttribute('type') || '').toLowerCase();

    if (typeAttr === 'button' || typeAttr === 'reset') {
      return false;
    }

    // Missing type or type="submit" → native submit behavior in a form.
    return !typeAttr || typeAttr === 'submit';
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
    const selectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button[data-submit]',
      '[data-submit]',
      'button.button--form',
      'button.form__btn',
      'button.btn',
      'button',
      'a.btn',
      'a.button',
      'a[class*="button"]',
      'div.button',
      'div.btn',
      'div[role="button"]',
      'span[role="button"]',
      'span.btn',
      'span.button',
      '[role="button"]',
    ];

    for (const selector of selectors) {
      for (const node of queryAllDeep(root, selector)) {
        if (!(node instanceof HTMLElement) || !isVisible(node)) {
          continue;
        }

        if (node instanceof HTMLAnchorElement && !isButtonLikeAnchor(node)) {
          continue;
        }

        if (
          node.matches('button[type="submit"], input[type="submit"], button[data-submit], [data-submit]')
          || (node instanceof HTMLButtonElement && isDefaultFormSubmit(node) && Boolean(node.closest('form')))
        ) {
          return node;
        }

        const text = `${node.textContent || ''} ${(node as HTMLInputElement).value || ''} ${node.getAttribute('aria-label') || ''}`.trim();

        if (SUBMIT_TEXT_RE.test(text)) {
          return node;
        }
      }
    }

    // Second pass: CTA links / divs styled as buttons inside lead blocks.
    for (const node of queryAllDeep(root, 'a.btn, a.button, a[class*="button"], div.button, div.btn, div[role="button"], span[role="button"], [role="button"]')) {
      if (!(node instanceof HTMLElement) || !isVisible(node)) {
        continue;
      }

      if (node instanceof HTMLAnchorElement && !isButtonLikeAnchor(node)) {
        continue;
      }

      const text = `${node.textContent || ''} ${node.getAttribute('aria-label') || ''}`.trim();

      if (SUBMIT_TEXT_RE.test(text)) {
        return node;
      }
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

    // Prefer class-based selectors for Nuxt buttons without type="submit" attribute.
    // NOTE: button.type DOM property defaults to "submit" even when attribute is missing —
    // CSS button[type="submit"] would NOT match those nodes.
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

    return 'button[type="submit"], button.button--form, button.btn, a.button, a.btn, button';
  }

  function findVisibleInputs(root: Element): HTMLInputElement[] {
    return queryAllDeep(root, 'input, textarea').filter(
      (input): input is HTMLInputElement =>
        input instanceof HTMLInputElement
        && isVisible(input)
        && !isInsideCustomSelectWidget(input),
    );
  }

  function findCheckboxes(root: Element): HTMLInputElement[] {
    return queryAllDeep(root, 'input[type="checkbox"]').filter((input): input is HTMLInputElement => {
      if (!(input instanceof HTMLInputElement)) {
        return false;
      }

      if (isVisible(input)) {
        return true;
      }

      // Custom checkbox UIs often hide the native input and style the label.
      const label = input.id
        ? document.querySelector(`label[for="${cssEscapeAttribute(input.id)}"]`)
        : input.closest('label');
      const labeled = label instanceof HTMLElement ? label : input.parentElement?.querySelector('label');

      return labeled instanceof HTMLElement && isVisible(labeled);
    });
  }

  function buildCheckboxSelector(checkbox: HTMLInputElement, root: Element): string | null {
    const name = checkbox.getAttribute('name');

    if (name) {
      return `input[name="${cssEscapeAttribute(name)}"][type="checkbox"]`;
    }

    if (checkbox.id && isStableElementId(checkbox.id)) {
      return `#${cssEscape(checkbox.id)}`;
    }

    const label = checkbox.closest('label');

    if (label instanceof HTMLElement) {
      const labelClass = typeof label.className === 'string'
        ? label.className.trim().split(/\s+/).find((token) => /agreement|consent|checkbox|privacy/i.test(token))
        : null;

      if (labelClass) {
        return `label.${cssEscape(labelClass)} input[type="checkbox"]`;
      }
    }

    if (root.querySelector('.form__agreement input[type="checkbox"]')) {
      return '.form__agreement input[type="checkbox"], label.base-checkbox input[type="checkbox"]';
    }

    return 'input[type="checkbox"]';
  }

  function scoreForm(parts: {
    phoneInput: HTMLInputElement;
    nameInput: HTMLInputElement | null;
    hasSubmit: boolean;
    checkboxCount: number;
    hasEmail?: boolean;
    hasTextarea?: boolean;
    isAuthForm?: boolean;
  }): number {
    let score = 0;

    if (isPhoneField(parts.phoneInput)) {
      score += SCORE_PHONE;
    }

    if (parts.hasSubmit) {
      score += SCORE_SUBMIT;
    }

    if (parts.nameInput) {
      score += SCORE_NAME;
    }

    if (parts.checkboxCount > 0) {
      score += SCORE_CHECKBOXES;
    }

    if (parts.hasEmail) {
      score += SCORE_EMAIL;
    }

    if (parts.hasTextarea) {
      score += SCORE_TEXTAREA;
    }

    if (parts.isAuthForm) {
      score += SCORE_AUTH_PENALTY;
    }

    return score;
  }

  function tryCollectFromRoot(root: Element, results: RawDetectedForm[], seenFingerprints: Set<string>): void {
    if (hasDisqualifyingExtraFields(root)) {
      return;
    }

    if (!isVisible(root) && !(root instanceof HTMLFormElement)) {
      // Forms may be opacity-animated; still require some visibility for non-forms.
      const style = root instanceof HTMLElement ? window.getComputedStyle(root) : null;

      if (style && (style.display === 'none' || style.visibility === 'hidden')) {
        return;
      }
    }

    const inputs = findVisibleInputs(root);

    if (inputs.length === 0) {
      return;
    }

    const submitButton = findSubmitButton(root);

    if (!submitButton) {
      return;
    }

    const phoneInput = inputs.find((input) => isPhoneField(input));

    if (!phoneInput) {
      return;
    }

    const firstNameInput = inputs.find((input) => input !== phoneInput && isFirstNameField(input)) ?? null;
    const lastNameInput = inputs.find((input) => input !== phoneInput && input !== firstNameInput && isLastNameField(input)) ?? null;
    const nameInput = inputs.find((input) =>
      input !== phoneInput
      && input !== firstNameInput
      && input !== lastNameInput
      && isCombinedNameField(input)) ?? null;
    const emailInput = inputs.find((input) => isEmailField(input)) ?? null;
    const selectSelectors = collectFillableSelectSelectors(root);
    const checkboxes = findCheckboxes(root);
    const hasEmail = Boolean(emailInput);
    const hasTextarea = queryAllDeep(root, 'textarea').some((node) => node instanceof HTMLTextAreaElement && isVisible(node));
    const isAuthForm = looksLikeAuthForm(root);
    const phoneSelector = buildInputSelector(phoneInput);
    const nameSelector = nameInput ? buildInputSelector(nameInput) : null;
    const firstNameSelector = firstNameInput ? buildInputSelector(firstNameInput) : null;
    const lastNameSelector = lastNameInput ? buildInputSelector(lastNameInput) : null;
    const emailSelector = emailInput ? buildInputSelector(emailInput) : null;
    const formScopeSelector = buildScopeSelector(root, phoneInput);
    const submitSelector = buildSubmitSelector(submitButton);
    const consentCheckboxSelectors = checkboxes
      .map((checkbox) => buildCheckboxSelector(checkbox, root))
      .filter((selector): selector is string => selector !== null);

    if (!phoneSelector) {
      return;
    }

    const score = scoreForm({
      phoneInput,
      nameInput: nameInput ?? firstNameInput ?? lastNameInput,
      hasSubmit: true,
      checkboxCount: checkboxes.length,
      hasEmail,
      hasTextarea,
      isAuthForm,
    });

    if (score < MIN_FORM_SCORE) {
      return;
    }

    const fingerprint = `${formScopeSelector}|${phoneSelector}|${submitSelector}|${firstNameSelector ?? ''}|${lastNameSelector ?? ''}|${emailSelector ?? ''}`;

    if (seenFingerprints.has(fingerprint)) {
      return;
    }

    seenFingerprints.add(fingerprint);
    results.push({
      formScopeSelector,
      nameSelector,
      firstNameSelector,
      lastNameSelector,
      emailSelector,
      selectSelectors,
      phoneSelector,
      submitSelector,
      consentCheckboxSelectors,
      fingerprint,
      score,
    });
  }

  const results: RawDetectedForm[] = [];
  const seenFingerprints = new Set<string>();
  let phonesSeen = 0;
  let formsScanned = 0;

  // Pass 1: real <form> elements (including slightly hidden modal forms + shadow hosts).
  for (const formNode of queryAllDeep(document, 'form')) {
    if (!(formNode instanceof HTMLFormElement)) {
      continue;
    }

    formsScanned += 1;

    const style = window.getComputedStyle(formNode);
    const rect = formNode.getBoundingClientRect();
    const maybeModalChild = Boolean(formNode.closest('[role="dialog"], .modal, .popup, .fancybox-content, .v-modal, .t-popup'));

    if (style.display === 'none' || style.visibility === 'hidden') {
      continue;
    }

    if (!maybeModalChild && (rect.width < 2 || rect.height < 2 || Number(style.opacity) === 0)) {
      continue;
    }

    tryCollectFromRoot(formNode, results, seenFingerprints);
  }

  phonesSeen = queryAllDeep(document, 'input').filter(
    (el) => el instanceof HTMLInputElement && isVisible(el) && isPhoneField(el),
  ).length;

  // Pass 2: non-form lead containers (modals / callback widgets).
  for (const node of queryAllDeep(document, CONTAINER_SELECTOR)) {
    if (node instanceof HTMLFormElement) {
      continue;
    }

    if (node.querySelector('form')) {
      continue;
    }

    formsScanned += 1;
    tryCollectFromRoot(node, results, seenFingerprints);
  }

  // Pass 3: orphan visible phone fields → climb to a sensible root.
  for (const input of queryAllDeep(document, 'input')) {
    if (!(input instanceof HTMLInputElement) || !isVisible(input) || !isPhoneField(input)) {
      continue;
    }

    if (input.closest('form')) {
      continue;
    }

    const root =
      input.closest(CONTAINER_SELECTOR)
      || input.closest('section, aside, article, .card, .widget')
      || input.parentElement?.parentElement;

    if (!root || root === document.body || root === document.documentElement) {
      continue;
    }

    formsScanned += 1;
    tryCollectFromRoot(root, results, seenFingerprints);
  }

  results.sort((left, right) => right.score - left.score);

  return {
    phonesSeen,
    formsScanned,
    forms: results,
  };
}
