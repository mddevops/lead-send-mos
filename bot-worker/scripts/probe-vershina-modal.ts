import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ locale: 'ru-RU' });
  await page.goto('https://vershina-krs.ru/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('button').filter({ hasText: /Заказать звонок/i }).first().click({ force: true });
  await page.waitForTimeout(2000);
  const dump = await page.evaluate(`(() => {
    const modal = document.querySelector('.v-modal');
    if (!modal) return { err: 'no modal' };
    const s = getComputedStyle(modal);
    const inputs = [...modal.querySelectorAll('input,textarea')].map((i) => ({
      tag: i.tagName, type: i.type, name: i.name, id: i.id, ph: i.placeholder,
      cls: String(i.className).slice(0, 80),
      autocomplete: i.getAttribute('autocomplete'),
      inputmode: i.getAttribute('inputmode'),
      visible: (() => { const r = i.getBoundingClientRect(); const cs = getComputedStyle(i); return cs.display !== 'none' && r.width > 0; })(),
      outer: i.outerHTML.slice(0, 200),
    }));
    return { cls: modal.className, display: s.display, classes: [...modal.classList], inputs, text: (modal.innerText||'').slice(0, 400) };
  })()`);
  console.log(JSON.stringify(dump, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
