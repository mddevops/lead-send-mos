import { chromium } from 'playwright';
import { dismissCommonOverlays, openFormModal } from '../src/utils/formInteractions';
import { navigateToUrl } from '../src/utils/navigate';

const URL = 'https://carmir-dealer.ru/used/kia/sorento/iv-2020-now/892151';
const OPEN = 'button.offer__page-controls-button';

async function tryViewport(width: number, height: number) {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width, height }, locale: 'ru-RU' });
  const page = await context.newPage();
  await navigateToUrl(page, URL, { timeoutMs: 60000, retries: 1 });
  await dismissCommonOverlays(page);
  const raw = page.locator(OPEN);
  const visible = page.locator(OPEN).filter({ visible: true });
  const info = {
    viewport: { width, height },
    rawCount: await raw.count(),
    visibleCount: await visible.count(),
    isVisible: await raw.first().isVisible().catch(() => false),
    box: await raw.first().boundingBox().catch(() => null),
  };
  let openOk = false;
  let openErr = '';
  try {
    await openFormModal(page, OPEN);
    openOk = true;
  } catch (e) {
    openErr = e instanceof Error ? e.message : String(e);
  }
  console.log(JSON.stringify({ ...info, openOk, openErr }, null, 2));
  await browser.close();
}

await tryViewport(1280, 720);
await tryViewport(1920, 1080);
