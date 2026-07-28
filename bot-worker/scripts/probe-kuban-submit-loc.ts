import { chromium } from 'playwright';
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'ru-RU', viewport: { width: 1440, height: 900 } });
  try {
    await page.goto('https://kuban-autohouse.ru/auto/lada/iskra/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    const data = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('button, input[type="submit"], a, [role="button"]')].map((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          type: el instanceof HTMLInputElement ? el.type : (el as HTMLButtonElement).type || null,
          text: ((el.textContent || '') + ' ' + ((el as HTMLInputElement).value || '') + ' ' + ((el as HTMLElement).getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim().slice(0, 120),
          visible: r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0,
          cls: String((el as HTMLElement).className || '').slice(0, 120),
          inForm: !!el.closest('form'),
          nearLead: !!el.closest('section, article, div')?.textContent?.match(/мобильный телефон|купить в кредит/i),
        };
      }).filter((x) => x.visible && (x.text.length > 0 || x.type === 'submit')).slice(0, 100);
      return nodes;
    });
    console.log(JSON.stringify(data.filter(x => /кредит|отправ|получить|заяв|брон|подроб|trade|звон/i.test(x.text) || x.inForm || x.nearLead), null, 2));
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
