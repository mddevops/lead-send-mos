/**
 * Dump modal HTML structure after CTA.
 */
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://xn----7sbg7aste.xn--p1ai/';

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ locale: 'ru-RU', viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('button').filter({ hasText: /Купить в кредит/i }).first().click({ force: true });
  await page.waitForTimeout(2000);
  const dump = await page.evaluate(`(() => {
    const vis = (el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 2 && r.height > 2;
    };
    const modals = [...document.querySelectorAll('.modal, [class*=modal]')].filter(vis);
    return modals.map((modal) => {
      const s = getComputedStyle(modal);
      return {
        modalCls: String(modal.className).slice(0, 120),
        display: s.display, visibility: s.visibility, opacity: s.opacity,
        classes: [...modal.classList],
        formTags: [...modal.querySelectorAll('form')].map((f) => String(f.className).slice(0, 80)),
        inputs: [...modal.querySelectorAll('input')].filter(vis).map((i) => ({
          type: i.type, name: i.name, ph: i.placeholder, id: i.id,
          cls: String(i.className).slice(0, 60),
        })),
        buttons: [...modal.querySelectorAll('button, a.button')].filter(vis).map((b) => ({
          tag: b.tagName, text: (b.innerText || '').trim().slice(0, 40), cls: String(b.className).slice(0, 60), type: b.getAttribute('type'),
        })),
      };
    });
  })()`);
  console.log(JSON.stringify(dump, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
