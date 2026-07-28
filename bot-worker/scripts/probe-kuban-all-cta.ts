import { chromium } from 'playwright';
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'ru-RU', viewport: { width: 1920, height: 1080 } });
  try {
    await page.goto('https://kuban-autohouse.ru/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    for (let i = 0; i < 6; i++) {
      await page.evaluate((step) => window.scrollTo(0, document.body.scrollHeight * step / 6), i + 1);
      await page.waitForTimeout(800);
    }
    const data = await page.evaluate(() => {
      return [...document.querySelectorAll('a, button, [role="button"]')].map((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        const text = ((el.textContent || '') + ' ' + ((el as HTMLElement).getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim();
        return {
          tag: el.tagName,
          text: text.slice(0, 120),
          href: (el as HTMLAnchorElement).href || null,
          cls: String((el as HTMLElement).className || '').slice(0, 120),
          visible: r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0,
          pos: s.position,
          x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        };
      }).filter((x) => x.visible && x.text.length > 0).slice(0, 200);
    });
    console.log(JSON.stringify(data, null, 2));
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
