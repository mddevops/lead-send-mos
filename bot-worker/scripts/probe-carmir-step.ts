/**
 * Step-through debug for carmir modal CTAs.
 */
import { chromium } from 'playwright';
import { findEntryPoints, discoverFormsViaModals } from '../src/utils/formModalDiscovery';
import { resolveOpenModalShell, closeOpenModal } from '../src/utils/formInteractions';

const CARD =
  'https://carmir-dealer.ru/used/volvo/s80/ii-restailing-2009-2013/845500';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(CARD, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const entries = (await findEntryPoints(page)).filter((e) => {
    const href = (e.href || '').trim();
    if (href && !href.startsWith('#') && (href.startsWith('/') || /^https?:/i.test(href))) return false;
    return true;
  });

  console.log('filtered entries', entries.map((e) => ({ text: e.text, sel: e.selector, p: e.priority })));

  for (const entry of entries.slice(0, 5)) {
    const before = page.url();
    const trigger = page.locator(entry.selector).filter({ visible: true }).first();
    const count = await trigger.count();
    console.log('\nCLICK', entry.text, entry.selector, 'count', count);
    if (count < 1) continue;

    await trigger.click({ timeout: 5000 }).catch((err) => console.log('click err', err.message));
    await page.waitForTimeout(1200);

    const shellInfo = await page.evaluate(() => {
      const wrap = document.querySelector('.modal__wrapper') as HTMLElement | null;
      const tel = document.querySelector('.modal__wrapper input[type="tel"], .modal__wrapper input[placeholder*="елефон" i]');
      return {
        url: location.href,
        wrapDisplay: wrap ? getComputedStyle(wrap).display : null,
        hasTel: Boolean(tel),
        submit: Boolean(document.querySelector('.modal__wrapper .button--form, .modal__wrapper div.button')),
      };
    });
    console.log('after click', shellInfo);

    try {
      const shell = await resolveOpenModalShell(page, 5000);
      const raw = await shell.evaluate((modalRoot) => {
        const inputs = [...modalRoot.querySelectorAll('input')].map((i) => ({
          type: (i as HTMLInputElement).type,
          ph: (i as HTMLInputElement).placeholder,
        }));
        const submits = [...modalRoot.querySelectorAll('button, div.button, div.btn')].map((el) => ({
          tag: el.tagName,
          cls: (el as HTMLElement).className?.toString?.().slice(0, 60),
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        }));
        return { tag: modalRoot.tagName, cls: (modalRoot as HTMLElement).className, inputs, submits };
      });
      console.log('shell ok', JSON.stringify(raw));
    } catch (error) {
      console.log('resolveOpenModalShell fail', (error as Error).message);
    }

    if (page.url() !== before) {
      await page.goto(before, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(800);
    } else {
      await closeOpenModal(page).catch(() => undefined);
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(400);
    }
  }

  await page.goto(CARD, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  const result = await discoverFormsViaModals(page, CARD, { maxTriggers: 6 });
  console.log('\nFINAL', JSON.stringify(result.forms, null, 2));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
