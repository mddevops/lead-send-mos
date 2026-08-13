const sitesEl = document.getElementById('sites');
const statusEl = document.getElementById('status');
const selectAllEl = document.getElementById('selectAll');
const bulkRegionEl = document.getElementById('bulkRegion');
const applyRegionBtn = document.getElementById('applyRegion');
const clearBtn = document.getElementById('clearBtn');
const sendBtn = document.getElementById('sendBtn');
const sendMenu = document.getElementById('sendMenu');
const settingsBtn = document.getElementById('settingsBtn');
const settingsDialog = document.getElementById('settingsDialog');
const destListEl = document.getElementById('destList');
const destEditId = document.getElementById('destEditId');
const destName = document.getElementById('destName');
const destBaseUrl = document.getElementById('destBaseUrl');
const destToken = document.getElementById('destToken');
const destSave = document.getElementById('destSave');
const destLoadMeta = document.getElementById('destLoadMeta');

let state = { destinations: [], sites: [], defaultDestinationId: null };
let regions = [];
let selected = new Set();

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function setStatus(text) {
  statusEl.textContent = text || '';
}

async function loadState() {
  const data = await chrome.storage.local.get(['destinations', 'sites', 'defaultDestinationId', 'regionsCache']);
  state = {
    destinations: Array.isArray(data.destinations) ? data.destinations : [],
    sites: Array.isArray(data.sites) ? data.sites : [],
    defaultDestinationId: data.defaultDestinationId || null,
  };
  regions = Array.isArray(data.regionsCache) ? data.regionsCache : [];
}

async function saveState(patch = {}) {
  state = { ...state, ...patch };
  await chrome.storage.local.set({
    destinations: state.destinations,
    sites: state.sites,
    defaultDestinationId: state.defaultDestinationId,
    regionsCache: regions,
  });
}

function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

async function fetchMeta(destination) {
  const base = normalizeBaseUrl(destination.baseUrl);
  const res = await fetch(`${base}/api/bot/extension/meta`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${destination.token}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function importSites(destination, sitesPayload) {
  const base = normalizeBaseUrl(destination.baseUrl);
  const res = await fetch(`${base}/api/bot/extension/import`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${destination.token}`,
    },
    body: JSON.stringify({
      replace_manual: true,
      sites: sitesPayload,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.message || json.errors?.[0]?.message || `Import HTTP ${res.status}`);
  }
  return json;
}

function renderRegionsSelect(selectEl, selectedId = '') {
  const current = String(selectedId || '');
  selectEl.innerHTML = `<option value="">Регион…</option>` + regions
    .map((r) => `<option value="${r.id}" ${String(r.id) === current ? 'selected' : ''}>${escapeHtml(r.name)}</option>`)
    .join('');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formPageList(form) {
  const urls = [
    ...(Array.isArray(form.source_urls) ? form.source_urls : []),
    form.source_url,
  ].filter(Boolean);
  return [...new Set(urls.map((u) => String(u).trim()).filter(Boolean))];
}

function expandFormsForImport(site) {
  const out = [];
  for (const form of site.forms || []) {
    const pages = formPageList(form);
    const urls = pages.length ? pages : [site.url];
    for (const sourceUrl of urls) {
      out.push({
        source_url: sourceUrl,
        name_selector: form.name_selector || null,
        first_name_selector: form.first_name_selector || null,
        last_name_selector: form.last_name_selector || null,
        email_selector: form.email_selector || null,
        select_selectors: form.select_selectors || [],
        phone_selector: form.phone_selector,
        submit_selector: form.submit_selector,
        open_modal_selector: form.open_modal_selector || null,
        pre_form_click_selectors: form.pre_form_click_selectors || [],
        pre_form_strategy: form.pre_form_strategy || (form.pre_form_click_selectors?.length ? 'selectors' : null),
        quiz_container_selector: form.quiz_container_selector || null,
        form_scope_selector: form.form_scope_selector || null,
        consent_checkbox_selector: form.consent_checkbox_selector || (form.consent_checkbox_selectors || [])[0] || null,
        consent_checkbox_selectors: form.consent_checkbox_selectors || [],
        success_selector: form.success_selector || null,
        success_text: form.success_text || null,
        error_selector: form.error_selector || null,
        wait_after_submit_ms: form.wait_after_submit_ms || 2000,
        status: 'active',
      });
    }
  }
  return out;
}

function renderSites() {
  if (!state.sites.length) {
    sitesEl.innerHTML = `<div class="empty">Пока пусто. Откройте сайт, Alt+Space — захват формы.</div>`;
    return;
  }

  sitesEl.innerHTML = state.sites.map((site) => {
    const checked = selected.has(site.id) ? 'checked' : '';
    const forms = (site.forms || []).map((form) => {
      const pages = formPageList(form);
      return `
      <div class="form-item" data-site-id="${site.id}" data-form-id="${form.id}">
        <div><strong>Шаблон формы</strong> · страниц: ${pages.length}</div>
        <div>phone: ${escapeHtml(form.phone_selector || '—')}</div>
        <div>first: ${escapeHtml(form.first_name_selector || '—')}</div>
        <div>last: ${escapeHtml(form.last_name_selector || '—')}</div>
        <div>fio: ${escapeHtml(form.name_selector || '—')}</div>
        <div>email: ${escapeHtml(form.email_selector || '—')}</div>
        <div>selects: ${(form.select_selectors || []).length}</div>
        <div>submit: ${escapeHtml(form.submit_selector || '—')}</div>
        <div>квиз: ${(form.pre_form_click_selectors || []).length || (form.pre_form_strategy === 'quiz_auto' ? 'auto' : '—')}</div>
        <div>success: ${escapeHtml(form.success_selector || form.success_text || '—')}</div>
        <label class="pages-label">Страницы с такой же формой (по одной URL в строке)</label>
        <textarea class="pages-input" data-site-id="${site.id}" data-form-id="${form.id}" rows="4" placeholder="https://example.com/page-1&#10;https://example.com/page-2">${escapeHtml(pages.join('\n'))}</textarea>
        <button type="button" class="btn pages-save" data-site-id="${site.id}" data-form-id="${form.id}">Сохранить страницы</button>
      </div>
    `;
    }).join('');

    const pageCount = (site.forms || []).reduce((n, f) => n + formPageList(f).length, 0);

    return `
      <article class="site" data-id="${site.id}">
        <div class="site-head">
          <input type="checkbox" class="site-check" data-id="${site.id}" ${checked} />
          <div>
            <div class="site-title">${escapeHtml(site.name || site.url)}</div>
            <div class="site-meta">${escapeHtml(site.url)} · шаблонов: ${(site.forms || []).length} · страниц: ${pageCount}</div>
          </div>
        </div>
        <div class="site-region">
          <select class="site-region-select" data-id="${site.id}"></select>
        </div>
        <div class="forms">${forms || '<div class="form-item">Нет форм</div>'}</div>
      </article>
    `;
  }).join('');

  sitesEl.querySelectorAll('.site-region-select').forEach((select) => {
    const site = state.sites.find((s) => s.id === select.dataset.id);
    renderRegionsSelect(select, site?.regionId || '');
  });
}

function renderBulkRegion() {
  renderRegionsSelect(bulkRegionEl, '');
}

function renderDestList() {
  if (!state.destinations.length) {
    destListEl.innerHTML = `<div class="empty">Нет destinations. Добавьте ниже.</div>`;
    return;
  }

  destListEl.innerHTML = state.destinations.map((d) => `
    <div class="dest-item">
      <div>
        <strong>${escapeHtml(d.name)}</strong>
        <small>${escapeHtml(d.baseUrl)}</small>
      </div>
      <div class="row">
        <button type="button" class="btn" data-edit="${d.id}">Изменить</button>
        <button type="button" class="btn btn-danger" data-del="${d.id}">Удалить</button>
      </div>
    </div>
  `).join('');
}

function renderSendMenu() {
  if (!state.destinations.length) {
    sendMenu.innerHTML = `<button type="button" disabled>Сначала добавьте destination в ⚙</button>`;
    return;
  }

  sendMenu.innerHTML = state.destinations.map((d) => `
    <button type="button" data-send="${d.id}">${escapeHtml(d.name)}<br><small>${escapeHtml(d.baseUrl)}</small></button>
  `).join('');
}

function selectedSites() {
  if (selected.size === 0) return [...state.sites];
  return state.sites.filter((s) => selected.has(s.id));
}

async function applyRegionToSelected(regionId) {
  const region = regions.find((r) => String(r.id) === String(regionId));
  if (!region) {
    setStatus('Выберите регион');
    return;
  }

  const targets = selected.size ? state.sites.filter((s) => selected.has(s.id)) : state.sites;
  if (!targets.length) {
    setStatus('Нет сайтов');
    return;
  }

  state.sites = state.sites.map((site) => {
    if (selected.size && !selected.has(site.id)) return site;
    return { ...site, regionId: region.id, regionName: region.name };
  });
  await saveState({ sites: state.sites });
  renderSites();
  setStatus(`Регион «${region.name}» применён к ${targets.length} сайт(ам)`);
}

async function clearSelected() {
  if (!state.sites.length) return;
  const count = selected.size || state.sites.length;
  if (!confirm(selected.size ? `Удалить выбранные сайты (${count})?` : 'Очистить все сайты?')) return;

  state.sites = selected.size
    ? state.sites.filter((s) => !selected.has(s.id))
    : [];
  selected = new Set();
  selectAllEl.checked = false;
  await saveState({ sites: state.sites });
  renderSites();
  setStatus('Очищено');
}

async function sendToDestination(destinationId) {
  const destination = state.destinations.find((d) => d.id === destinationId);
  if (!destination) {
    setStatus('Destination не найден');
    return;
  }

  const targets = selectedSites();
  if (!targets.length) {
    setStatus('Нет сайтов для отправки');
    return;
  }

  const invalid = targets.filter((s) => !s.regionId || !(s.forms || []).length);
  if (invalid.length) {
    setStatus(`У ${invalid.length} сайт(ов) нет региона или форм. Назначьте регион.`);
    return;
  }

  const payload = targets.map((site) => ({
    url: site.url,
    name: site.name || site.url,
    region_id: Number(site.regionId),
    forms: expandFormsForImport(site),
  }));

  const totalForms = payload.reduce((n, s) => n + s.forms.length, 0);
  if (totalForms > 50) {
    setStatus(`Слишком много страниц (${totalForms}). Максимум 50 на сайт при импорте.`);
    return;
  }

  setStatus(`Отправка в ${destination.name}…`);
  sendMenu.classList.add('hidden');

  try {
    const result = await importSites(destination, payload);
    const errCount = (result.errors || []).length;
    setStatus(
      `OK: создано сайтов ${result.created_sites || 0}, обновлено ${result.updated_sites || 0}, ` +
      `маппингов ${result.created_mappings || 0}` +
      (errCount ? `\nОшибки (${errCount}): ${(result.errors || []).map((e) => e.message).join('; ')}` : ''),
    );

    if (confirm('Удалить успешно отправленные сайты из расширения?')) {
      const sentIds = new Set(targets.map((t) => t.id));
      state.sites = state.sites.filter((s) => !sentIds.has(s.id));
      selected = new Set();
      await saveState({ sites: state.sites });
      renderSites();
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

sitesEl.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.classList.contains('site-check')) {
    if (t.checked) selected.add(t.dataset.id);
    else selected.delete(t.dataset.id);
    return;
  }

  if (t.classList.contains('site-region-select')) {
    const region = regions.find((r) => String(r.id) === String(t.value));
    state.sites = state.sites.map((site) => {
      if (site.id !== t.dataset.id) return site;
      return {
        ...site,
        regionId: region ? region.id : null,
        regionName: region ? region.name : null,
      };
    });
    await saveState({ sites: state.sites });
  }
});

sitesEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('.pages-save');
  if (!btn) return;

  const siteId = btn.dataset.siteId;
  const formId = btn.dataset.formId;
  const textarea = sitesEl.querySelector(
    `textarea.pages-input[data-site-id="${siteId}"][data-form-id="${formId}"]`,
  );
  if (!textarea) return;

  const urls = String(textarea.value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && /^https?:\/\//i.test(line));

  if (!urls.length) {
    setStatus('Добавьте хотя бы один URL (http/https), по одному в строке');
    return;
  }

  state.sites = state.sites.map((site) => {
    if (site.id !== siteId) return site;
    return {
      ...site,
      forms: (site.forms || []).map((form) => {
        if (form.id !== formId) return form;
        return {
          ...form,
          source_url: urls[0],
          source_urls: urls,
        };
      }),
    };
  });

  await saveState({ sites: state.sites });
  renderSites();
  setStatus(`Сохранено страниц: ${urls.length}`);
});

selectAllEl.addEventListener('change', () => {
  if (selectAllEl.checked) {
    selected = new Set(state.sites.map((s) => s.id));
  } else {
    selected = new Set();
  }
  renderSites();
});

applyRegionBtn.addEventListener('click', () => applyRegionToSelected(bulkRegionEl.value));
clearBtn.addEventListener('click', () => clearSelected());

sendBtn.addEventListener('click', () => {
  sendMenu.classList.toggle('hidden');
  renderSendMenu();
});

sendMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-send]');
  if (!btn) return;
  sendToDestination(btn.dataset.send);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.send-dropdown')) {
    sendMenu.classList.add('hidden');
  }
});

settingsBtn.addEventListener('click', () => {
  renderDestList();
  settingsDialog.showModal();
});

destListEl.addEventListener('click', async (e) => {
  const editId = e.target.closest('[data-edit]')?.dataset.edit;
  const delId = e.target.closest('[data-del]')?.dataset.del;

  if (editId) {
    const d = state.destinations.find((x) => x.id === editId);
    if (!d) return;
    destEditId.value = d.id;
    destName.value = d.name;
    destBaseUrl.value = d.baseUrl;
    destToken.value = d.token;
    return;
  }

  if (delId) {
    state.destinations = state.destinations.filter((d) => d.id !== delId);
    if (state.defaultDestinationId === delId) {
      state.defaultDestinationId = state.destinations[0]?.id || null;
    }
    await saveState({
      destinations: state.destinations,
      defaultDestinationId: state.defaultDestinationId,
    });
    renderDestList();
  }
});

destSave.addEventListener('click', async () => {
  const name = destName.value.trim();
  const baseUrl = normalizeBaseUrl(destBaseUrl.value);
  const token = destToken.value.trim();
  if (!name || !baseUrl || !token) {
    setStatus('Заполните name / baseUrl / token');
    return;
  }

  const id = destEditId.value || uid('dest');
  const existingIdx = state.destinations.findIndex((d) => d.id === id);
  const item = { id, name, baseUrl, token };

  if (existingIdx >= 0) state.destinations[existingIdx] = item;
  else state.destinations.push(item);

  if (!state.defaultDestinationId) state.defaultDestinationId = id;

  await saveState({
    destinations: state.destinations,
    defaultDestinationId: state.defaultDestinationId,
  });

  destEditId.value = '';
  destName.value = '';
  destBaseUrl.value = '';
  destToken.value = '';
  renderDestList();
  setStatus(`Destination «${name}» сохранён`);
});

destLoadMeta.addEventListener('click', async () => {
  let destination = null;
  if (destEditId.value) {
    destination = state.destinations.find((d) => d.id === destEditId.value);
  }
  if (!destination && destBaseUrl.value && destToken.value) {
    destination = {
      baseUrl: normalizeBaseUrl(destBaseUrl.value),
      token: destToken.value.trim(),
      name: destName.value.trim() || 'temp',
    };
  }
  if (!destination) {
    destination = state.destinations[0];
  }
  if (!destination) {
    setStatus('Нет destination для проверки');
    return;
  }

  try {
    const meta = await fetchMeta(destination);
    regions = Array.isArray(meta.regions) ? meta.regions : [];
    await chrome.storage.local.set({ regionsCache: regions });
    renderBulkRegion();
    renderSites();
    setStatus(`Регионов загружено: ${regions.length}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

(async function init() {
  await loadState();

  if (!state.destinations.length) {
    state.destinations = [{
      id: uid('dest'),
      name: 'Local',
      baseUrl: 'http://127.0.0.1:8000',
      token: 'local-bot-token',
    }];
    state.defaultDestinationId = state.destinations[0].id;
    await saveState({
      destinations: state.destinations,
      defaultDestinationId: state.defaultDestinationId,
    });
  }

  if (!regions.length && state.destinations[0]) {
    try {
      const meta = await fetchMeta(state.destinations[0]);
      regions = Array.isArray(meta.regions) ? meta.regions : [];
      await chrome.storage.local.set({ regionsCache: regions });
    } catch {
      // offline / token — регионы подтянутся из настроек
    }
  }

  renderBulkRegion();
  renderSites();
  renderSendMenu();
  setStatus(`Сайтов: ${state.sites.length}`);
})();
