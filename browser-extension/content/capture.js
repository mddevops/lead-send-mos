(() => {
  if (window.__leadSendFormMapperLoaded) return;
  window.__leadSendFormMapperLoaded = true;

  const ROLES = [
    { id: 'open_modal', label: 'Открыть модалку', required: false },
    { id: 'pre_click', label: 'Шаг квиза', required: false, multi: true },
    { id: 'phone', label: 'Телефон', required: true },
    { id: 'name', label: 'Имя', required: false },
    { id: 'submit', label: 'Submit', required: true },
    { id: 'consent_1', label: 'Чекбокс 1', required: false },
    { id: 'consent_2', label: 'Чекбокс 2', required: false },
    { id: 'form_scope', label: 'Область формы', required: false },
    { id: 'success', label: 'Success', required: false },
  ];

  const CONSENT_ROLE_IDS = new Set(['consent_1', 'consent_2']);

  let active = false;
  let roleIndex = 0;
  let draft = emptyDraft();
  let hoverEl = null;
  let overlay = null;
  let successWatch = null;
  /** When true, next click is not captured (real click / post open_modal). */
  let passThroughClicks = false;

  function emptyDraft() {
    return {
      source_url: location.href,
      phone_selector: null,
      name_selector: null,
      submit_selector: null,
      open_modal_selector: null,
      pre_form_click_selectors: [],
      pre_form_strategy: null,
      quiz_container_selector: null,
      form_scope_selector: null,
      consent_checkbox_selectors: [],
      success_selector: null,
      success_text: null,
    };
  }

  function cssEscapeIdent(value) {
    if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(value);
    return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  }

  function queryAll(root, sel) {
    try {
      return Array.from((root || document).querySelectorAll(sel));
    } catch {
      return [];
    }
  }

  function isUniqueMatch(root, sel, el) {
    const matches = queryAll(root, sel);
    return matches.length === 1 && matches[0] === el;
  }

  /** Nearest form / modal container for phone/name/submit. */
  function findFieldRoot(el) {
    if (!(el instanceof Element)) return null;
    return (
      el.closest('form') ||
      el.closest('[role="dialog"], .modal, .popup, [class*="modal" i], [class*="popup" i]') ||
      null
    );
  }

  /**
   * Build CSS selector unique inside `root` (defaults to document).
   * Prefer short local selectors — do NOT climb to ambiguous page IDs like duplicated #count-price.
   */
  function buildSelector(el, root = document) {
    if (!(el instanceof Element)) return null;

    const scopeRoot = root instanceof Element || root === document ? root : document;
    const scoped = scopeRoot !== document && scopeRoot.contains(el);

    // Inside a form scope: prefer attributes unique within that form only.
    if (scoped && el !== scopeRoot) {
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type');
      const name = el.getAttribute('name');
      const placeholder = el.getAttribute('placeholder');

      if (type === 'submit' && isUniqueMatch(scopeRoot, `${tag}[type="submit"]`, el)) {
        return `${tag}[type="submit"]`;
      }
      if (tag === 'button' && type !== 'button' && isUniqueMatch(scopeRoot, 'button[type="submit"]', el)) {
        return 'button[type="submit"]';
      }
      if (tag === 'button' && isUniqueMatch(scopeRoot, 'button', el)) {
        return 'button';
      }
      if (name) {
        const byName = `${tag}[name="${name.replace(/"/g, '\\"')}"]`;
        if (isUniqueMatch(scopeRoot, byName, el)) return byName;
        if (type) {
          const withType = `${byName}[type="${type}"]`;
          if (isUniqueMatch(scopeRoot, withType, el)) return withType;
        }
      }
      if (type) {
        const byType = `${tag}[type="${type}"]`;
        if (isUniqueMatch(scopeRoot, byType, el)) return byType;
      }
      if (placeholder) {
        const byPh = `${tag}[placeholder="${placeholder.replace(/"/g, '\\"')}"]`;
        if (isUniqueMatch(scopeRoot, byPh, el)) return byPh;
      }
      if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
        const byId = `#${cssEscapeIdent(el.id)}`;
        if (isUniqueMatch(scopeRoot, byId, el)) return byId;
      }
      const classList = Array.from(el.classList).filter((c) => c && !/hover|active|focus|open|show|lsfm/i.test(c));
      if (classList.length) {
        const byClass = `${tag}.${classList.slice(0, 2).map(cssEscapeIdent).join('.')}`;
        if (isUniqueMatch(scopeRoot, byClass, el)) return byClass;
      }

      // Relative path from form root → element (never includes outer ambiguous IDs).
      return buildRelativePath(el, scopeRoot);
    }

    // Page-global selector (for form_scope / open_modal / success).
    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id) && isUniqueMatch(document, `#${cssEscapeIdent(el.id)}`, el)) {
      return `#${cssEscapeIdent(el.id)}`;
    }

    const tag = el.tagName.toLowerCase();
    const name = el.getAttribute('name');
    if (name) {
      const byName = `${tag}[name="${name.replace(/"/g, '\\"')}"]`;
      if (isUniqueMatch(document, byName, el)) return byName;
    }

    const classList = Array.from(el.classList).filter((c) => c && !/hover|active|focus|open|show|lsfm/i.test(c));
    if (classList.length) {
      const byClass = `${tag}.${classList.slice(0, 3).map(cssEscapeIdent).join('.')}`;
      if (isUniqueMatch(document, byClass, el)) return byClass;
    }

    // form:has(...) when this is a form with a distinctive field
    if (tag === 'form') {
      const marked = el.querySelector('input[name], input[type="tel"], button[type="submit"], button');
      if (marked) {
        const inner = buildSelector(marked, el);
        if (inner) {
          const hasSel = `form:has(${inner})`;
          if (isUniqueMatch(document, hasSel, el)) return hasSel;
        }
      }
    }

    return buildRelativePath(el, document.body);
  }

  function buildRelativePath(el, stopAt) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== stopAt) {
      const parent = node.parentElement;
      if (!parent) break;
      const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      const tagName = node.tagName.toLowerCase();
      if (siblings.length > 1) {
        parts.unshift(`${tagName}:nth-of-type(${siblings.indexOf(node) + 1})`);
      } else {
        parts.unshift(tagName);
      }
      // Only use id if unique in document (avoid #count-price x3).
      if (node.id && /^[a-zA-Z][\w-]*$/.test(node.id)) {
        const idSel = `#${cssEscapeIdent(node.id)}`;
        if (queryAll(document, idSel).length === 1) {
          parts.unshift(idSel);
          break;
        }
      }
      node = parent;
      if (parts.length > 8) break;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  }

  /** Auto-bind form scope from phone/name/submit click. */
  function ensureFormScope(el) {
    const form = findFieldRoot(el);
    if (!form) return null;

    if (!draft.form_scope_selector || !document.querySelector(draft.form_scope_selector)) {
      draft.form_scope_selector = buildSelector(form, document);
    }

    // Resolve live root from saved selector, fallback to found form.
    let root = form;
    if (draft.form_scope_selector) {
      try {
        const matched = document.querySelector(draft.form_scope_selector);
        if (matched && matched.contains(el)) root = matched;
      } catch {
        // ignore
      }
    }
    return root;
  }

  /**
   * Resolve click target to a single checkbox input.
   * Rejects wrappers that contain 2+ checkboxes — pick Чекбокс 1 / 2 separately.
   */
  function resolveConsentElement(el) {
    if (!(el instanceof Element)) return null;

    const isCheckbox = (node) => {
      if (!(node instanceof Element)) return false;
      const tag = node.tagName.toLowerCase();
      const type = (node.getAttribute('type') || '').toLowerCase();
      if (tag === 'input' && (type === 'checkbox' || type === 'radio')) return true;
      return (node.getAttribute('role') || '').toLowerCase() === 'checkbox';
    };

    if (isCheckbox(el)) return el;

    if (el.tagName === 'LABEL') {
      const nested = el.querySelector('input[type="checkbox"], input[type="radio"], [role="checkbox"]');
      if (nested && isCheckbox(nested)) return nested;
      const forId = el.getAttribute('for');
      if (forId) {
        const target = document.getElementById(forId);
        if (target && isCheckbox(target)) return target;
      }
    }

    const label = el.closest('label');
    if (label && label !== el) {
      const fromLabel = resolveConsentElement(label);
      if (fromLabel) return fromLabel;
    }

    const boxes = Array.from(
      el.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="checkbox"]'),
    ).filter(isCheckbox);

    if (boxes.length === 1) return boxes[0];
    if (boxes.length > 1) {
      flash('Два чекбокса в контейнере — отметьте Чекбокс 1 и Чекбокс 2 отдельно');
      return null;
    }

    // Custom toggle UI without a nested input — keep the clicked control.
    return el;
  }

  function consentSlotIndex(roleId) {
    if (roleId === 'consent_1') return 0;
    if (roleId === 'consent_2') return 1;
    return -1;
  }

  /** Random Angular/SPA ids like agreementPUkqO53yd364HB7DkC42 break on next page load. */
  function isUnstableDomId(id) {
    if (!id) return true;
    if (/^(agreement|informationAgreement)[A-Za-z0-9_-]{6,}$/i.test(id)) return true;
    if (id.length >= 18 && /[A-Z]/.test(id) && /[a-z]/.test(id) && /\d/.test(id)) return true;
    return false;
  }

  /**
   * Consent must survive page reloads — never save ephemeral #agreementXxx ids.
   * Saving input[type=checkbox] / .tr-native-checkbox lets the worker check all boxes in the form.
   */
  function buildConsentSelector(el, root) {
    const scopeRoot = root instanceof Element ? root : document;
    if (!(el instanceof Element)) return null;

    if (el.matches('input[type="checkbox"], input[type="radio"]')) {
      if (el.classList.contains('tr-native-checkbox')) {
        return 'input.tr-native-checkbox';
      }
      if (el.getAttribute('name')) {
        const byName = `input[name="${el.getAttribute('name').replace(/"/g, '\\"')}"]`;
        if (isUniqueMatch(scopeRoot, byName, el) && !isUnstableDomId(el.getAttribute('name'))) {
          return byName;
        }
      }
      return 'input[type="checkbox"]';
    }

    if ((el.getAttribute('role') || '').toLowerCase() === 'checkbox') {
      const nested = el.querySelector('input[type="checkbox"], input[type="radio"]');
      if (nested) return buildConsentSelector(nested, scopeRoot);
      return '[role="checkbox"]';
    }

    const nested = el.querySelector('input[type="checkbox"], input[type="radio"]');
    if (nested) return buildConsentSelector(nested, scopeRoot);

    const built = buildSelector(el, scopeRoot);
    if (built && built.startsWith('#') && isUnstableDomId(el.id)) {
      return 'input[type="checkbox"]';
    }
    return built;
  }

  function setConsentSlot(slot, selector) {
    const list = Array.isArray(draft.consent_checkbox_selectors)
      ? [...draft.consent_checkbox_selectors]
      : [];
    while (list.length <= slot) list.push(null);
    list[slot] = selector;
    draft.consent_checkbox_selectors = list;
    draft.consent_checkbox_selector = list.find((s) => Boolean(s)) || null;
  }

  function compactConsentSelectors() {
    return (draft.consent_checkbox_selectors || []).filter((s) => Boolean(s && String(s).trim()));
  }

  function compactList(list) {
    return (Array.isArray(list) ? list : []).filter((s) => Boolean(s && String(s).trim()));
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'lsfm-overlay';
    overlay.innerHTML = `
      <div class="lsfm-bar">
        <div class="lsfm-title">Form Mapper · Alt+Space вкл/выкл · Alt+клик = обычный клик</div>
        <div class="lsfm-role" id="lsfm-role"></div>
        <div class="lsfm-roles" id="lsfm-roles"></div>
        <div class="lsfm-actions">
          <button type="button" data-act="skip">Пропустить роль</button>
          <button type="button" data-act="watch">Watch success</button>
          <button type="button" data-act="save">Сохранить форму</button>
          <button type="button" data-act="reset">Сброс</button>
          <button type="button" data-act="close">Закрыть</button>
        </div>
        <div class="lsfm-hint" id="lsfm-hint"></div>
      </div>
    `;
    document.documentElement.appendChild(overlay);

    overlay.querySelector('#lsfm-roles').innerHTML = ROLES.map(
      (r, i) => `<button type="button" class="lsfm-role-btn" data-role-index="${i}">${r.label}</button>`,
    ).join('');

    overlay.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();

      if (btn.dataset.roleIndex != null) {
        roleIndex = Number(btn.dataset.roleIndex);
        renderOverlay();
        return;
      }

      const act = btn.dataset.act;
      if (act === 'close') deactivate();
      if (act === 'reset') {
        draft = emptyDraft();
        roleIndex = 0;
        renderOverlay();
      }
      if (act === 'skip') {
        if (roleIndex < ROLES.length - 1) {
          roleIndex += 1;
          renderOverlay();
          flash(`Пропущено → ${ROLES[roleIndex].label}`);
        }
      }
      if (act === 'save') saveDraft();
      if (act === 'watch') startSuccessWatch();
    });

    return overlay;
  }

  function renderOverlay() {
    ensureOverlay();
    const role = ROLES[roleIndex];
    let roleHint = '';
    if (CONSENT_ROLE_IDS.has(role.id)) {
      roleHint = ' — клик по самому input/label, не по общему контейнеру';
    } else if (role.id === 'pre_click') {
      roleHint = ' — кликайте варианты квиза по порядку (можно несколько)';
    } else if (role.multi) {
      roleHint = ' (можно несколько)';
    }
    overlay.querySelector('#lsfm-role').textContent = `Роль: ${role.label}${roleHint}`;
    overlay.querySelectorAll('.lsfm-role-btn').forEach((btn, i) => {
      btn.classList.toggle('is-active', i === roleIndex);
    });

    const consents = draft.consent_checkbox_selectors || [];
    const quizSteps = draft.pre_form_click_selectors || [];
    const lines = [
      `URL: ${draft.source_url}`,
      `open_modal: ${draft.open_modal_selector || '—'}`,
      `квиз: ${quizSteps.length ? quizSteps.map((s, i) => `${i + 1}`).join('→') + ` (${quizSteps.length})` : '—'}`,
      `phone: ${draft.phone_selector || '—'}`,
      `name: ${draft.name_selector || '—'}`,
      `submit: ${draft.submit_selector || '—'}`,
      `чекбокс1: ${consents[0] || '—'}`,
      `чекбокс2: ${consents[1] || '—'}`,
      `scope: ${draft.form_scope_selector || '—'}`,
      `success: ${draft.success_selector || draft.success_text || '—'}`,
    ];
    overlay.querySelector('#lsfm-hint').textContent = lines.join(' · ');
    overlay.classList.toggle('is-active', active);
  }

  function setHover(el) {
    if (hoverEl) hoverEl.classList.remove('lsfm-hover');
    hoverEl = el instanceof Element ? el : null;
    if (hoverEl) hoverEl.classList.add('lsfm-hover');
  }

  function assignRole(el) {
    const role = ROLES[roleIndex];
    const scopedRoles = new Set(['phone', 'name', 'submit', 'consent_1', 'consent_2', 'form_scope']);

    let targetEl = el;
    if (CONSENT_ROLE_IDS.has(role.id)) {
      const resolved = resolveConsentElement(el);
      if (!resolved) return;
      targetEl = resolved;
    }

    let root = document;
    if (scopedRoles.has(role.id) && role.id !== 'form_scope') {
      root = ensureFormScope(targetEl) || document;
    } else if (role.id === 'form_scope') {
      root = document;
    }

    let selector;
    if (role.id === 'form_scope') {
      const form = findFieldRoot(targetEl) || targetEl;
      selector = buildSelector(form, document);
      draft.form_scope_selector = selector;
    } else if (role.id === 'open_modal' || role.id === 'success' || role.id === 'pre_click') {
      selector = buildSelector(targetEl, document);
    } else if (CONSENT_ROLE_IDS.has(role.id)) {
      selector = buildConsentSelector(targetEl, root instanceof Element ? root : document);
    } else {
      // phone / name / submit — only inside the same form
      selector = buildSelector(targetEl, root instanceof Element ? root : document);
    }

    if (!selector) return;

    targetEl.classList.add('lsfm-picked');

    if (role.id === 'phone') draft.phone_selector = selector;
    if (role.id === 'name') draft.name_selector = selector;
    if (role.id === 'submit') draft.submit_selector = selector;
    if (role.id === 'open_modal') draft.open_modal_selector = selector;
    if (role.id === 'pre_click') {
      if (!Array.isArray(draft.pre_form_click_selectors)) {
        draft.pre_form_click_selectors = [];
      }
      draft.pre_form_click_selectors.push(selector);
      draft.pre_form_strategy = 'selectors';
    }
    if (CONSENT_ROLE_IDS.has(role.id)) {
      const slot = consentSlotIndex(role.id);
      setConsentSlot(slot, selector);
    }
    if (role.id === 'success') {
      draft.success_selector = selector;
      const text = (targetEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (text) draft.success_text = text;
      stopSuccessWatch();
    }

    draft.source_url = location.href;

    // Multi roles (quiz steps) stay active so user can click next options.
    if (!role.multi && roleIndex < ROLES.length - 1) {
      roleIndex += 1;
    }

    renderOverlay();
    const scopeNote = draft.form_scope_selector ? ` (в форме)` : '';
    const quizNote = role.id === 'pre_click'
      ? ` #${draft.pre_form_click_selectors.length}`
      : '';
    flash(`Сохранено: ${role.label}${quizNote}${scopeNote}`);
  }

  function flash(text) {
    let el = document.getElementById('lsfm-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lsfm-toast';
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('is-visible');
    clearTimeout(flash._t);
    flash._t = setTimeout(() => el.classList.remove('is-visible'), 1400);
  }

  function activate() {
    active = true;
    draft.source_url = location.href;
    ensureOverlay();
    renderOverlay();
    flash('Alt+Space — панель. Alt+клик — обычный клик (открыть модалку).');
  }

  function deactivate() {
    active = false;
    setHover(null);
    stopSuccessWatch();
    if (overlay) overlay.classList.remove('is-active');
    document.querySelectorAll('.lsfm-hover, .lsfm-picked').forEach((el) => {
      el.classList.remove('lsfm-hover');
    });
  }

  function toggle() {
    if (active) deactivate();
    else activate();
  }

  function siteKeyFromUrl(url) {
    try {
      return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
      return null;
    }
  }

  function uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Save via chrome.storage (no runtime.sendMessage — survives extension reload better). */
  async function upsertFormLocally(formPayload) {
    if (!chrome?.storage?.local) {
      throw new Error('Нет доступа к storage — обновите страницу (F5) после Reload расширения');
    }

    const data = await chrome.storage.local.get(['sites']);
    const sites = Array.isArray(data.sites) ? data.sites : [];
    const key = siteKeyFromUrl(formPayload.source_url || formPayload.siteUrl);
    if (!key) throw new Error('Не удалось определить сайт по URL');

    const origin = (() => {
      try {
        return new URL(formPayload.source_url || formPayload.siteUrl).origin;
      } catch {
        return `https://${key}`;
      }
    })();

    let site = sites.find((s) => siteKeyFromUrl(s.url) === key);
    if (!site) {
      site = {
        id: uid('site'),
        url: origin,
        name: key,
        regionId: null,
        regionName: null,
        forms: [],
      };
      sites.push(site);
    }

    const consentSelectors = Array.isArray(formPayload.consent_checkbox_selectors)
      ? formPayload.consent_checkbox_selectors.filter((s) => Boolean(s && String(s).trim()))
      : [];
    const preFormSelectors = Array.isArray(formPayload.pre_form_click_selectors)
      ? formPayload.pre_form_click_selectors.filter((s) => Boolean(s && String(s).trim()))
      : [];

    const form = {
      id: uid('form'),
      source_url: formPayload.source_url || origin,
      source_urls: [formPayload.source_url || origin].filter(Boolean),
      name_selector: formPayload.name_selector || null,
      phone_selector: formPayload.phone_selector || null,
      submit_selector: formPayload.submit_selector || null,
      open_modal_selector: formPayload.open_modal_selector || null,
      pre_form_click_selectors: preFormSelectors,
      pre_form_strategy: formPayload.pre_form_strategy
        || (preFormSelectors.length > 0 ? 'selectors' : null),
      quiz_container_selector: formPayload.quiz_container_selector || null,
      form_scope_selector: formPayload.form_scope_selector || null,
      consent_checkbox_selector: consentSelectors[0] || formPayload.consent_checkbox_selector || null,
      consent_checkbox_selectors: consentSelectors,
      success_selector: formPayload.success_selector || null,
      success_text: formPayload.success_text || null,
      error_selector: formPayload.error_selector || null,
      mapping_type: 'manual',
      status: 'active',
      wait_after_submit_ms: 2000,
      captured_at: new Date().toISOString(),
    };

    const existingIdx = site.forms.findIndex(
      (f) =>
        f.phone_selector === form.phone_selector
        && f.submit_selector === form.submit_selector
        && (f.form_scope_selector || null) === (form.form_scope_selector || null),
    );

    if (existingIdx >= 0) {
      const prev = site.forms[existingIdx];
      const urls = new Set([
        ...(Array.isArray(prev.source_urls) ? prev.source_urls : []),
        prev.source_url,
        ...form.source_urls,
      ].filter(Boolean));
      site.forms[existingIdx] = {
        ...prev,
        ...form,
        id: prev.id,
        source_url: prev.source_url || form.source_url,
        source_urls: [...urls],
      };
    } else {
      site.forms.push(form);
    }

    await chrome.storage.local.set({ sites });
    return { site, form: site.forms[existingIdx >= 0 ? existingIdx : site.forms.length - 1] };
  }

  async function saveDraft() {
    if (!draft.phone_selector || !draft.submit_selector) {
      flash('Нужны phone и submit');
      return;
    }

    try {
      const preFormSelectors = compactList(draft.pre_form_click_selectors);
      const payload = {
        ...draft,
        consent_checkbox_selectors: compactConsentSelectors(),
        consent_checkbox_selector: compactConsentSelectors()[0] || null,
        pre_form_click_selectors: preFormSelectors,
        pre_form_strategy: preFormSelectors.length > 0 ? 'selectors' : (draft.pre_form_strategy || null),
        siteUrl: location.origin,
      };
      const result = await upsertFormLocally(payload);
      flash(`Форма сохранена: ${result.site?.name || 'site'}. Страницы — в popup.`);
      draft = emptyDraft();
      roleIndex = 0;
      renderOverlay();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      flash(msg.includes('Extension context')
        ? 'Расширение перезагружено — нажмите F5 на странице'
        : msg);
    }
  }

  function stopSuccessWatch() {
    if (successWatch?.observer) successWatch.observer.disconnect();
    if (successWatch?.timer) clearInterval(successWatch.timer);
    successWatch = null;
  }

  function startSuccessWatch() {
    stopSuccessWatch();
    const startUrl = location.href;
    const seen = new Set();
    flash('Watch: отправьте форму — поймаем success');

    const observer = new MutationObserver(() => {
      const candidates = document.querySelectorAll(
        '[class*="success" i], [class*="thank" i], [class*="thanks" i], [class*="modal" i], [role="dialog"], .popup, .fancybox-content',
      );
      for (const el of candidates) {
        if (!(el instanceof HTMLElement)) continue;
        if (el.offsetParent === null && getComputedStyle(el).display === 'none') continue;
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length < 4 || text.length > 280) continue;
        if (!/(спасибо|отправлен|заявк|успеш|принят|thank|success)/i.test(text)) continue;
        const key = `${el.tagName}:${text.slice(0, 40)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const selector = buildSelector(el);
        if (!selector) continue;
        draft.success_selector = selector;
        draft.success_text = text.slice(0, 120);
        roleIndex = ROLES.findIndex((r) => r.id === 'success');
        renderOverlay();
        flash('Success найден — нажмите «Сохранить форму»');
        stopSuccessWatch();
        return;
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    const timer = setInterval(() => {
      if (location.href !== startUrl) {
        draft.success_text = `redirect:${location.href}`;
        draft.success_selector = null;
        renderOverlay();
        flash('Редирект после отправки зафиксирован');
        stopSuccessWatch();
      }
    }, 500);

    successWatch = { observer, timer };
    roleIndex = ROLES.findIndex((r) => r.id === 'success');
    renderOverlay();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && active) {
      e.preventDefault();
      deactivate();
      return;
    }

    // Alt+Space — toggle panel (also Alt+Shift+M as fallback if OS eats Space)
    const tag = (e.target && e.target.tagName) ? String(e.target.tagName).toLowerCase() : '';
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
    if (typing) return;

    const altSpace = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.code === 'Space' || e.key === ' ');
    const altShiftM = e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyM' || e.key === 'M' || e.key === 'm');

    if (altSpace || altShiftM) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      toggle();
    }
  }

  function onMouseOver(e) {
    if (!active || passThroughClicks) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    if (el.closest('#lsfm-overlay, #lsfm-toast')) return;
    setHover(el);
  }

  function onClick(e) {
    if (!active) return;
    if (passThroughClicks) return;

    const el = e.target;
    if (!(el instanceof Element)) return;
    if (el.closest('#lsfm-overlay, #lsfm-toast')) return;

    // Alt+click = обычный клик (открыть модалку, не перехватывать)
    if (e.altKey) {
      setHover(null);
      flash('Обычный клик');
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const roleBefore = ROLES[roleIndex];
    assignRole(el);

    // После «Открыть модалку» / «Шаг квиза» — реальный клик, чтобы UI перешёл дальше
    if (roleBefore?.id === 'open_modal' || roleBefore?.id === 'pre_click') {
      passThroughClicks = true;
      setHover(null);
      setTimeout(() => {
        try {
          el.click();
          flash(roleBefore.id === 'pre_click'
            ? `Квиз шаг ${draft.pre_form_click_selectors.length}: сохранён + клик`
            : 'Модалка: селектор сохранён + клик');
        } catch {
          flash('Селектор сохранён — кликните с Alt, если шаг не сработал');
        }
        setTimeout(() => {
          passThroughClicks = false;
        }, 500);
      }, 30);
    }
  }

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('click', onClick, true);
})();
