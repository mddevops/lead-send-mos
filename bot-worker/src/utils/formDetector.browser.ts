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
    /ваш\s+номер\s+телефона|номер\s+телефона|ваш\s+телефон|телефон\*?|phone|\+7|8\s*\(|_{2,}|\(\s*_{2,}|\+\s*7/i;
  const PHONE_NAME_RE =
    /(?:^|[_-])(phone|tel|mobile|telefon|телефон|телефончик|phone_num|phonenumber)(?:$|[_-])/i;
  // Site builders (e.g. mary{hash}phone / mary{hash}name) — id ends with field role.
  const PHONE_ID_SUFFIX_RE = /(phone|tel|telephone|mobile|telefon)$/i;
  const NAME_ID_SUFFIX_RE = /(name|fio|firstname|first_name)$/i;
  const NAME_PLACEHOLDER_RE =
    /ваше\s+имя|введите\s+имя|^имя\*?$|(?:^|[\s:])имя(?:\s|\*|$)|\bимя\b|ф\.?\s*и\.?\s*о\.?|фио|fio|first\s*name|your\s+name|фамил|отчество/i;
  const EMAIL_FIELD_RE = /e-?mail|почта|электронн\w*\s+почт/i;
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

    // Fake placeholders rendered as sibling overlays (common on dealer SPAs).
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
      nearbyFieldLabel(input),
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

  function buildInputSelector(input: HTMLInputElement): string | null {
    // Prefer stable semantic ids (#phone) before generic name=tel shared across forms.
    if (
      input.id
      && isStableElementId(input.id)
      && (
        /^(phone|tel|telephone|mobile|name|fio)$/i.test(input.id)
        || PHONE_ID_SUFFIX_RE.test(input.id)
        || NAME_ID_SUFFIX_RE.test(input.id)
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

      if (NAME_PLACEHOLDER_RE.test(placeholder)) {
        return `input[placeholder*="${cssEscapeAttribute(shortPh)}"]`;
      }
    }

    if (type === 'tel') {
      return 'input[type="tel"]';
    }

    const nearby = nearbyFieldLabel(input);

    // Dealer SPAs often use overlay placeholders instead of placeholder=.
    if ((type === 'text' || type === '') && NAME_PLACEHOLDER_RE.test(nearby)) {
      return 'input[type="text"]';
    }

    if ((type === 'text' || type === '') && PHONE_PLACEHOLDER_RE.test(nearby)) {
      return 'input[type="text"]';
    }

    const inputMode = (input.getAttribute('inputmode') || '').toLowerCase();

    if (inputMode === 'tel' || inputMode === 'numeric' || inputMode === 'decimal') {
      // Many RU dealer sites mark phone as inputmode=numeric without name=.
      if (PHONE_PLACEHOLDER_RE.test(placeholder) || PHONE_PLACEHOLDER_RE.test(inputContext(input))) {
        return `input[inputmode="${cssEscapeAttribute(inputMode)}"]`;
      }
    }

    return null;
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

      if (isPhoneField(input) || isNameField(input)) {
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

    // select: only "when to call" style is allowed; car/city/etc. are not.
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

      return /перезвон|когда\s+звон|время\s+звон|удобн\w*\s+врем|call.?time|callback.?time/i.test(context);
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
   * Skip forms that need more than name + phone + consent
   * (email, car, city, arrival time, product picker, etc.).
   */
  function hasDisqualifyingExtraFields(root: Element): boolean {
    // Explicit car / product pickers (often without HTML required).
    // Avoid matching BEM fragments like catalog-model--credit (contains "--c…").
    const carPicker = root.querySelector(
      '[class*="car-select"], [class*="select-car"], [class*="pick-car"], [data-car], [data-vehicle], select[name*="car"], select[name*="model"]',
    );

    if (carPicker && isVisible(carPicker)) {
      return true;
    }

    const rootText = (root.textContent || '').replace(/\s+/g, ' ');

    if (/выбрать\s+автомобил|выбор\s+автомобил|укажите\s+автомобил|выберите\s+(авто|машин|модель)/i.test(rootText)) {
      // Only when that text is part of a field control, not page marketing.
      const controlWithCar = [...root.querySelectorAll('button, label, select, [role="button"], .form__field, [class*="field"]')]
        .some((el) => /выбрать\s+автомобил|выбор\s+автомобил|укажите\s+автомобил|выберите\s+(авто|машин|модель)/i.test(el.textContent || ''));

      if (controlWithCar) {
        return true;
      }
    }

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
      }

      if (!isVisible(node) && !(node instanceof HTMLSelectElement && node.required)) {
        continue;
      }

      if (isAllowedLeadField(node)) {
        // Allowed fields are fine even when required (name/phone).
        continue;
      }

      // Disallowed field present: skip if required OR looks like a hard business field.
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

      // Any other visible non-lead text input beyond name/phone → skip (too complex),
      // except a single anonymous text field next to phone (name without placeholder/name=).
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
        if (node instanceof HTMLInputElement) {
          const textInputs = [...root.querySelectorAll('input')].filter((el) => {
            if (!(el instanceof HTMLInputElement) || !isVisible(el)) {
              return false;
            }
            const t = (el.getAttribute('type') || 'text').toLowerCase();
            return t === 'text' || t === 'search' || t === '';
          });
          const phoneCount = textInputs.filter((el) => isPhoneField(el)).length;
          const nameCount = textInputs.filter((el) => isNameField(el)).length;
          const unknownCount = textInputs.length - phoneCount - nameCount;

          if (phoneCount >= 1 && nameCount === 0 && unknownCount === 1) {
            // Likely "name" field with empty placeholder / generated id — allow.
            continue;
          }
        }

        return true;
      }
    }

    return false;
  }

  function isNameField(input: HTMLInputElement): boolean {
    const type = (input.getAttribute('type') || 'text').toLowerCase();

    if (SKIP_INPUT_TYPES.has(type) || type === 'tel' || type === 'email' || type === 'search') {
      return false;
    }

    if (isPhoneField(input) || isEmailField(input)) {
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

    // Tilda / builders: name="Name", name="name[]", autocomplete=name
    if (/^name(\[\]|$)/i.test(name) || /^(name|given-name|family-name)$/i.test((input.getAttribute('autocomplete') || '').trim())) {
      return true;
    }

    const placeholder = (input.getAttribute('placeholder') || '').trim();
    const context = inputContext(input);

    return NAME_PLACEHOLDER_RE.test(placeholder) || NAME_PLACEHOLDER_RE.test(context);
  }

  function isPhoneField(input: HTMLInputElement): boolean {
    const context = inputContext(input);

    if (NON_LEAD_PHONE_RE.test(context)) {
      return false;
    }

    const dataType = (input.getAttribute('data-type') || '').toUpperCase();
    const dataName = (input.getAttribute('data-name') || '').toLowerCase();

    if (dataType === 'PHONE' || dataType === 'TEL') {
      return true;
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
      (input): input is HTMLInputElement => input instanceof HTMLInputElement && isVisible(input),
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

    const nameInput = inputs.find((input) => input !== phoneInput && isNameField(input)) ?? null;
    const checkboxes = findCheckboxes(root);
    const hasEmail = inputs.some((input) => isEmailField(input));
    const hasTextarea = queryAllDeep(root, 'textarea').some((node) => node instanceof HTMLTextAreaElement && isVisible(node));
    const isAuthForm = looksLikeAuthForm(root);
    const phoneSelector = buildInputSelector(phoneInput);
    const nameSelector = nameInput ? buildInputSelector(nameInput) : null;
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
      nameInput,
      hasSubmit: true,
      checkboxCount: checkboxes.length,
      hasEmail,
      hasTextarea,
      isAuthForm,
    });

    if (score < MIN_FORM_SCORE) {
      return;
    }

    const fingerprint = `${formScopeSelector}|${phoneSelector}|${submitSelector}`;

    if (seenFingerprints.has(fingerprint)) {
      return;
    }

    seenFingerprints.add(fingerprint);
    results.push({
      formScopeSelector,
      nameSelector,
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
