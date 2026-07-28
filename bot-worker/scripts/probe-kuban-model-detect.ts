import { chromium } from 'playwright';
import { getCollectFormsInDocument } from '../dist/utils/browserEvaluate.js';
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'ru-RU', viewport: { width: 1440, height: 900 } });
  try {
    const url = 'https://kuban-autohouse.ru/auto/lada/iskra/';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    const raw = await page.evaluate(getCollectFormsInDocument());
    console.log(JSON.stringify(raw, null, 2));
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
