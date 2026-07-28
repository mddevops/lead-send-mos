import { chromium } from 'playwright';
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'ru-RU', viewport: { width: 1440, height: 900 } });
  try {
    await page.goto('https://kuban-autohouse.ru/auto/lada/iskra/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    const data = await page.evaluate(() => {
      return [...document.querySelectorAll('form')].map((form, i) => {
        const fs = getComputedStyle(form);
        const fr = form.getBoundingClientRect();
        return {
          i,
          text: (form.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
          formVisible: fr.width > 0 && fr.height > 0 && fs.display !== 'none' && fs.visibility !== 'hidden' && Number(fs.opacity) !== 0,
          className: String(form.className || '').slice(0, 120),
          fields: [...form.querySelectorAll('input, button, select, textarea, label')].map((el) => {
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return {
              tag: el.tagName.toLowerCase(),
              type: el instanceof HTMLInputElement ? el.type : null,
              name: (el as HTMLInputElement).name || null,
              id: (el as HTMLInputElement).id || null,
              placeholder: (el as HTMLInputElement).placeholder || null,
              text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
              visible: r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0,
              cls: String((el as HTMLElement).className || '').slice(0, 120),
            };
          }),
        };
      });
    });
    console.log(JSON.stringify(data, null, 2));
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
