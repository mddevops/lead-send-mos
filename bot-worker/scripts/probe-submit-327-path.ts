/**
 * Reproduce submitLead open-modal path for site 327 mapping.
 */
import { openBrowser, closeBrowser } from '../src/playwright/browser';
import {
  dismissCommonOverlays,
  openFormModal,
} from '../src/utils/formInteractions';
import { navigateToUrl } from '../src/utils/navigate';
import { normalizePageUrl } from '../src/utils/formScanUtils';
import { pickBrowserFingerprint } from '../src/utils/browserProfiles';

const URL = 'https://carmir-dealer.ru/used/kia/sorento/iv-2020-now/892151';
const OPEN = 'button.offer__page-controls-button';

async function main() {
  const fingerprint = pickBrowserFingerprint({ id: 1, name: 'Москва' });
  const session = await openBrowser(undefined, {
    fingerprint,
    region: { id: 1, name: 'Москва' },
    headless: true,
  });
  const page = await session.context.newPage();

  try {
    const submitUrl = normalizePageUrl(URL);
    console.log('goto', submitUrl, 'viewport', fingerprint.viewport);
    await navigateToUrl(page, submitUrl, { timeoutMs: 60000, retries: 1 });
    console.log('after nav', page.url(), 'title', await page.title());

    await dismissCommonOverlays(page);
    console.log('after overlays', page.url());

    const raw = page.locator(OPEN);
    const visible = page.locator(OPEN).filter({ visible: true });
    console.log(JSON.stringify({
      rawCount: await raw.count(),
      visibleCount: await visible.count(),
      rawVisible: await raw.first().isVisible().catch(() => false),
      text: ((await raw.first().textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim(),
      box: await raw.first().boundingBox().catch(() => null),
    }, null, 2));

    try {
      await openFormModal(page, OPEN);
      console.log('openFormModal OK, url', page.url());
      const tel = await page.locator('.modal__wrapper input[type=tel], .modal__content input[type=tel]').count();
      console.log('tel in modal', tel);
    } catch (error) {
      console.log('openFormModal FAIL', error instanceof Error ? error.message : error);
    }
  } finally {
    await closeBrowser(session);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
