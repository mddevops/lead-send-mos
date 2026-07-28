const { chromium } = require('playwright');
const { collectFormsInDocument } = require('../dist/utils/formDetector.browser');
const { scanSiteForForms } = require('../dist/utils/formScanner');

const url = process.argv[2] ?? 'https://yug-avto-expert.ru';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'ru-RU' });

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    const homepage = await page.evaluate(collectFormsInDocument);
    console.log('=== Homepage immediate detect ===');
    console.log(JSON.stringify(homepage, null, 2));

    const scanned = await scanSiteForForms(page, url);
    console.log('=== Full crawl ===');
    console.log(JSON.stringify(scanned, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
