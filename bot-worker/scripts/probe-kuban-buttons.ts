import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'ru-RU', viewport: { width: 1920, height: 1080 } });
  try {
    await page.goto('https://kuban-autohouse.ru/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
    await page.waitForTimeout(1500);
    const data = await page.evaluate(() => {
      const items = [...document.querySelectorAll('a, button, [role="button"], [onclick]')]
        .map((el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          const text = ((el.textContent || '') + ' ' + ((el as HTMLElement).getAttribute('aria-label') || '') + ' ' + ((el as HTMLElement).getAttribute('title') || '')).replace(/\s+/g, ' ').trim();
          return {
            tag: el.tagName,
            text: text.slice(0, 120),
            href: (el as HTMLAnchorElement).href || null,
            cls: String((el as HTMLElement).className || '').slice(0, 120),
            pos: s.position,
            right: s.right,
            left: s.left,
            bottom: s.bottom,
            z: s.zIndex,
            visible: r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0,
            x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
          };
        })
        .filter((x) => x.visible && x.text.length > 0)
        .filter((x) => /подроб|скидк|заяв|кредит|тест|рассроч|предлож|звон|trade|трейд|отправ|брон|акци|кноп|узна/i.test(x.text) || x.pos === 'fixed')
        .slice(0, 120);
      return items;
    });
    console.log(JSON.stringify(data, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
