import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { getCollectFormsInDocument } from '../dist/utils/browserEvaluate.js';
import { findEntryPoints } from '../dist/utils/formModalDiscovery.js';

const url = 'https://kuban-autohouse.ru/';

async function main() {
  mkdirSync('storage', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'ru-RU', viewport: { width: 1920, height: 1080 } });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    const initial = await page.evaluate(() => {
      const forms = [...document.querySelectorAll('form')].map((form, i) => ({
        i,
        className: String(form.className || '').slice(0, 120),
        action: form.getAttribute('action'),
        text: (form.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240),
        inputs: [...form.querySelectorAll('input, select, textarea, button')].map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el instanceof HTMLInputElement ? el.type : null,
          name: (el as HTMLInputElement).name || null,
          id: (el as HTMLInputElement).id || null,
          placeholder: (el as HTMLInputElement).placeholder || null,
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          visible: el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
        })),
      }));

      const fixedCtas = [...document.querySelectorAll('a, button, [role="button"]')]
        .map((el) => {
          const style = getComputedStyle(el as Element);
          const rect = (el as Element).getBoundingClientRect();
          return {
            tag: (el as Element).tagName,
            text: ((el.textContent || '') + ' ' + ((el as HTMLElement).getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim().slice(0, 80),
            href: (el as HTMLAnchorElement).href || null,
            position: style.position,
            right: style.right,
            left: style.left,
            bottom: style.bottom,
            z: style.zIndex,
            visible: rect.width > 0 && rect.height > 0,
            cls: String((el as HTMLElement).className || '').slice(0, 120),
          };
        })
        .filter((x) => x.visible && (x.position === 'fixed' || x.position === 'sticky' || /кредит|тест|рассроч|предложен|заявк|скидк|звонок/i.test(x.text)));

      return { forms, fixedCtas };
    });

    const detected = await page.evaluate(getCollectFormsInDocument());
    const entryPoints = await findEntryPoints(page);

    const actions = [];
    for (const entry of entryPoints.slice(0, 6)) {
      const before = page.url();
      const trigger = page.locator(entry.selector).filter({ visible: true }).first();
      let clicked = false;
      if (await trigger.count()) {
        await trigger.click({ force: true, timeout: 5000 }).catch(() => undefined);
        clicked = true;
        await page.waitForTimeout(1500);
      }

      const state = await page.evaluate(() => ({
        dialogs: [...document.querySelectorAll('dialog, [role="dialog"], .modal, .popup, .base-dialog')].map((el) => ({
          tag: el.tagName,
          cls: String((el as HTMLElement).className || '').slice(0, 120),
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
          visible: (() => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0; })(),
        })).filter((d) => d.visible),
        forms: [...document.querySelectorAll('form')].map((form) => ({
          text: (form.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
          visible: (() => { const r = form.getBoundingClientRect(); const s = getComputedStyle(form); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0; })(),
          inputs: [...form.querySelectorAll('input, select, button')].map((el) => ({
            tag: el.tagName.toLowerCase(),
            type: el instanceof HTMLInputElement ? el.type : null,
            name: (el as HTMLInputElement).name || null,
            placeholder: (el as HTMLInputElement).placeholder || null,
            text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          })),
        })).filter((f) => f.visible),
      }));

      actions.push({ entry, clicked, urlAfter: page.url(), navigated: page.url() !== before, state });

      if (page.url() !== before) {
        await page.goto(before, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => undefined);
        await page.waitForTimeout(1200);
      } else {
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(500);
      }
    }

    const out = { initial, detected, entryPoints, actions };
    writeFileSync('storage/probe-kuban-autohouse.json', JSON.stringify(out, null, 2), 'utf8');
    console.log('detected forms:', detected.forms.length, 'phonesSeen:', detected.phonesSeen, 'formsScanned:', detected.formsScanned);
    console.log('entryPoints:', entryPoints.slice(0, 10).map((e) => ({ text: e.text, href: e.href, selector: e.selector, priority: e.priority })));
    console.log('actions summary:', actions.map((a) => ({ text: a.entry.text, navigated: a.navigated, clicked: a.clicked, dialogs: a.state.dialogs.length, visibleForms: a.state.forms.length })));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
