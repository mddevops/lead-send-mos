const STORAGE_KEYS = {
  destinations: 'destinations',
  sites: 'sites',
  defaultDestinationId: 'defaultDestinationId',
};

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function getState() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.destinations,
    STORAGE_KEYS.sites,
    STORAGE_KEYS.defaultDestinationId,
  ]);

  return {
    destinations: Array.isArray(data.destinations) ? data.destinations : [],
    sites: Array.isArray(data.sites) ? data.sites : [],
    defaultDestinationId: data.defaultDestinationId || null,
  };
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
  return getState();
}

function siteKeyFromUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

async function upsertFormMapping(formPayload) {
  const state = await getState();
  const key = siteKeyFromUrl(formPayload.source_url || formPayload.siteUrl);
  if (!key) {
    throw new Error('Не удалось определить сайт по URL');
  }

  const origin = (() => {
    try {
      return new URL(formPayload.source_url || formPayload.siteUrl).origin;
    } catch {
      return `https://${key}`;
    }
  })();

  let site = state.sites.find((s) => siteKeyFromUrl(s.url) === key);
  if (!site) {
    site = {
      id: uid('site'),
      url: origin,
      name: key,
      regionId: null,
      regionName: null,
      forms: [],
    };
    state.sites.push(site);
  }

  const form = {
    id: formPayload.id || uid('form'),
    source_url: formPayload.source_url || origin,
    source_urls: Array.isArray(formPayload.source_urls)
      ? formPayload.source_urls
      : [formPayload.source_url || origin].filter(Boolean),
    name_selector: formPayload.name_selector || null,
    phone_selector: formPayload.phone_selector || null,
    submit_selector: formPayload.submit_selector || null,
    open_modal_selector: formPayload.open_modal_selector || null,
    pre_form_click_selectors: Array.isArray(formPayload.pre_form_click_selectors)
      ? formPayload.pre_form_click_selectors
      : [],
    pre_form_strategy: formPayload.pre_form_strategy
      || (Array.isArray(formPayload.pre_form_click_selectors) && formPayload.pre_form_click_selectors.length
        ? 'selectors'
        : null),
    quiz_container_selector: formPayload.quiz_container_selector || null,
    form_scope_selector: formPayload.form_scope_selector || null,
    consent_checkbox_selector: formPayload.consent_checkbox_selector || null,
    consent_checkbox_selectors: Array.isArray(formPayload.consent_checkbox_selectors)
      ? formPayload.consent_checkbox_selectors
      : [],
    success_selector: formPayload.success_selector || null,
    success_text: formPayload.success_text || null,
    error_selector: formPayload.error_selector || null,
    mapping_type: 'manual',
    status: 'active',
    wait_after_submit_ms: formPayload.wait_after_submit_ms || 2000,
    captured_at: new Date().toISOString(),
  };

  // Same selectors = same form template (merge pages instead of duplicating).
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
      form.source_url,
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

  await setState({ sites: state.sites });
  return { site, form };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === 'GET_STATE') {
        sendResponse({ ok: true, state: await getState() });
        return;
      }

      if (message?.type === 'SAVE_FORM') {
        const result = await upsertFormMapping(message.form || {});
        sendResponse({ ok: true, ...result });
        return;
      }

      if (message?.type === 'SET_STATE') {
        const next = await setState(message.patch || {});
        sendResponse({ ok: true, state: next });
        return;
      }

      sendResponse({ ok: false, error: 'unknown_message' });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();

  return true;
});
