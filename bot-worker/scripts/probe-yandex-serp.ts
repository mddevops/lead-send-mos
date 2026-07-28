/**
 * Probe Yandex SERP Promo structure for debugging.
 * Usage: npx tsx scripts/probe-yandex-serp.ts "Купить авто в Москве"
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const query = process.argv[2] || 'Купить авто в Москве';
const cookiePath = path.resolve(__dirname, '../storage/yandex-cookies/direct.json');

async function main() {
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    locale: 'ru-RU',
    viewport: { width: 1920, height: 1080 },
    storageState: fs.existsSync(cookiePath) ? cookiePath : undefined,
  });
  const page = await context.newPage();

  await page.goto('https://ya.ru/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);

  const input = page.locator('input#text, input[name="text"], textarea[name="text"]').first();
  await input.click();
  await input.fill(query);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4000);

  // If captcha — stop and dump URL for manual insight
  if (/showcaptcha/i.test(page.url())) {
    console.log(JSON.stringify({ url: page.url(), captcha: true }, null, 2));
    await page.waitForTimeout(15000);
    await browser.close();
    return;
  }

  await page.waitForSelector('#search-result, ul.serp-list', { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(2000);

  const dump = await page.evaluate(() => {
    const list = document.querySelector('#search-result') || document.querySelector('ul.serp-list');
    const li = list ? Array.from(list.children).filter((c) => c.tagName === 'LI') : [];
    const promoTexts: string[] = [];
    for (const el of document.querySelectorAll('span, div')) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^(Промо|Реклама)$/i.test(t)) promoTexts.push(t + ' @' + (el.className || '').toString().slice(0, 80));
    }

    return {
      url: location.href,
      listId: list?.id || null,
      listClass: typeof (list as HTMLElement | null)?.className === 'string' ? (list as HTMLElement).className : null,
      liCount: li.length,
      liSamples: li.slice(0, 8).map((el) => ({
        className: typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className.slice(0, 120) : '',
        dataCid: el.getAttribute('data-cid'),
        hasScroller: Boolean(el.querySelector('[class*="Scroller"], [class*="scroller"]')),
        textHead: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
        hasPromoWord: /\bПромо\b|\bРеклама\b/i.test(el.textContent || ''),
      })),
      promoLabelCount: promoTexts.length,
      promoLabels: promoTexts.slice(0, 20),
    };
  });

  console.log(JSON.stringify(dump, null, 2));
  await context.storageState({ path: cookiePath }).catch(() => undefined);
  await page.waitForTimeout(3000);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
