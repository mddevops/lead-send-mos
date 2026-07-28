import { chromium } from 'playwright';
import { getCollectFormsInDocument } from '../src/utils/browserEvaluate';
import { dismissCommonOverlays } from '../src/utils/formInteractions';
import { scanSiteForForms } from '../src/utils/formScanner';

const url = process.argv[2] ?? 'https://xn----7sbg7aste.xn--p1ai/';

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'ru-RU' });
  const collect = getCollectFormsInDocument();

  try {
    const contactsUrl = new URL('/contacts', url).toString();
    await page.goto(contactsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    await dismissCommonOverlays(page);

    const onContacts = await page.evaluate(collect);
    console.log('=== /contacts detect ===');
    console.log(JSON.stringify(onContacts, null, 2));

    const scanned = await scanSiteForForms(page, url, {
      maxPages: 8,
      oneMappingPerPage: true,
      discoverModals: true,
    });
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
