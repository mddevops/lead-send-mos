/**
 * Verify modal form discovery on carmir card CTAs.
 * Usage: npx tsx scripts/probe-carmir-modal-discover.ts
 */
import { chromium } from 'playwright';
import { discoverFormsViaModals, findEntryPoints } from '../src/utils/formModalDiscovery';
import { isModelCardUrl, scoreLink } from '../src/utils/formScanUtils';

const CARD =
  'https://carmir-dealer.ru/used/volvo/s80/ii-restailing-2009-2013/845500';
const BASE = 'https://carmir-dealer.ru/';

async function main() {
  console.log('isModelCardUrl', isModelCardUrl(CARD));
  console.log('scores', {
    card: scoreLink(CARD, BASE),
    credit: scoreLink(`${BASE}credit`, BASE),
    exchange: scoreLink(`${BASE}exchange`, BASE),
    catalog: scoreLink(BASE, BASE),
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(CARD, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const entries = await findEntryPoints(page);
  console.log(
    'entryPoints',
    entries.slice(0, 12).map((e) => ({ text: e.text, href: e.href, priority: e.priority, selector: e.selector })),
  );

  const result = await discoverFormsViaModals(page, CARD, { maxTriggers: 6 });
  console.log(
    JSON.stringify(
      {
        triggersTried: result.triggersTried,
        entryPointsFound: result.entryPointsFound,
        forms: result.forms.map((f) => ({
          open: f.open_modal_selector,
          phone: f.phone_selector,
          submit: f.submit_selector,
          scope: f.form_scope_selector,
          confidence: f.confidence,
          url: f.source_url,
        })),
      },
      null,
      2,
    ),
  );

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
