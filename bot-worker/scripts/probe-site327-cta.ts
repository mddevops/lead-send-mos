import { chromium } from 'playwright';

const urls = [
  'https://carmir-dealer.ru/used/kia/sorento/iv-2020-now/892151',
  'https://carmir-dealer.ru/used/kia/rio/iv-2017-2020/967635',
];

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();

  for (const url of urls) {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
    await page.waitForTimeout(2500);

    const exact = page.locator('button.offer__page-controls-button');
    const credit = page.locator('div.button--credit');
    const trade = page.locator('div.button--info, div.button.trade-in');
    const anyOffer = page.locator('button[class*="offer__page-controls"]');

    const dump = async (loc: ReturnType<typeof page.locator>, limit = 6) => {
      const n = await loc.count();
      const rows = [];
      for (let i = 0; i < Math.min(n, limit); i += 1) {
        const el = loc.nth(i);
        rows.push({
          text: ((await el.textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 50),
          visible: await el.isVisible().catch(() => false),
          cls: await el.getAttribute('class').catch(() => ''),
        });
      }
      return { count: n, rows };
    };

    console.log(JSON.stringify({
      url,
      http: res?.status() ?? null,
      final: page.url(),
      title: await page.title(),
      exact: await dump(exact),
      credit: await dump(credit),
      trade: await dump(trade),
      anyOffer: await dump(anyOffer),
    }, null, 2));
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
