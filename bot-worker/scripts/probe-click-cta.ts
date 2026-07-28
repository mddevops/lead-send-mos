/**
 * Click first matching CTA and dump visible forms/modals.
 * Usage: npx tsx scripts/probe-click-cta.ts https://example.ru "Купить в кредит"
 */
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://example.ru';
const cta = process.argv[3] || 'Купить в кредит';

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ locale: 'ru-RU', viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    const before = await page.evaluate(() => ({
      buttons: [...document.querySelectorAll('button, a, [role=button], .btn, [class*=btn]')]
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80))
        .filter((t) => /кредит|звонок|заявк|предложен|купить|callback/i.test(t))
        .slice(0, 20),
    }));
    console.log('BEFORE', JSON.stringify(before, null, 2));

    const locator = page.locator(`button, a, [role=button]`).filter({ hasText: new RegExp(cta, 'i') }).first();
    const count = await page.locator(`button, a, [role=button]`).filter({ hasText: new RegExp(cta, 'i') }).count();
    console.log('CTA matches:', count);
    if (count > 0) {
      await locator.click({ timeout: 8000, force: true }).catch(async (e) => {
        console.log('click err', String(e));
        await locator.evaluate((el) => (el as HTMLElement).click());
      });
      await page.waitForTimeout(2500);
    }

    const after = await page.evaluate(`(() => {
      const vis = (el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 2 && r.height > 2;
      };
      const forms = [...document.querySelectorAll('form, [class*=form], .wpcf7, .t-form')]
        .filter(vis)
        .map((f) => ({
          tag: f.tagName,
          id: f.id,
          cls: String(f.className || '').slice(0, 100),
          inputs: [...f.querySelectorAll('input,textarea,select,button,a')]
            .filter(vis)
            .slice(0, 15)
            .map((i) => ({
              tag: i.tagName,
              type: i.type || null,
              name: i.name || null,
              ph: i.placeholder || null,
              text: (i.innerText || '').slice(0, 40),
            })),
        }));
      const dialogs = [...document.querySelectorAll('[role=dialog], .modal, .popup, [class*=modal], [class*=popup], [class*=dialog]')]
        .filter(vis)
        .map((d) => ({
          cls: String(d.className || '').slice(0, 100),
          text: (d.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 250),
        }));
      const phones = [...document.querySelectorAll('input')].filter((i) => vis(i) && (/tel|phone/i.test(i.type + i.name + (i.placeholder||'')))).map((i) => ({
        type: i.type, name: i.name, ph: i.placeholder, id: i.id,
      }));
      return { url: location.href, forms, dialogs, phones };
    })()`);
    console.log('AFTER', JSON.stringify(after, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
