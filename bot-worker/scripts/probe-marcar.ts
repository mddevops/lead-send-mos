import { chromium } from 'playwright';
import { dismissCommonOverlays, clickVisible, waitForModalForm } from '../src/utils/formInteractions';

const url = 'https://marcar.ru/';

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: null, locale: 'ru-RU' });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dismissCommonOverlays(page);
    await page.waitForTimeout(2000);

    const before = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button.ordercall')].map((el) => ({
        text: (el.textContent || '').trim().slice(0, 60),
        visible: !!(el as HTMLElement).offsetParent,
        rect: el.getBoundingClientRect(),
        class: el.className,
      }));

      return {
        ordercallCount: buttons.length,
        buttons,
        forms: document.querySelectorAll('form').length,
        visibleForms: [...document.querySelectorAll('form')].filter((f) => {
          const r = f.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }).length,
      };
    });

    console.log('=== Before click ===');
    console.log(JSON.stringify(before, null, 2));

    const trigger = page.locator('button.ordercall');
    console.log('ordercall locator count:', await trigger.count());
    console.log('visible count:', await trigger.filter({ visible: true }).count());

    await clickVisible(trigger);
    await page.waitForTimeout(2000);

    const afterClick = await page.evaluate(() => {
      const modals = [...document.querySelectorAll('[class*="modal"], [class*="popup"], [role="dialog"], .fancybox-container, .mfp-wrap')].map((el) => ({
        tag: el.tagName,
        class: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
        visible: !!(el as HTMLElement).offsetParent,
        inputs: el.querySelectorAll('input').length,
      }));

      const inputs = [...document.querySelectorAll('input')].map((el) => ({
        type: el.getAttribute('type'),
        name: el.getAttribute('name'),
        placeholder: el.getAttribute('placeholder'),
        visible: !!(el as HTMLElement).offsetParent,
      }));

      return { modals, inputs };
    });

    console.log('=== After click ===');
    console.log(JSON.stringify(afterClick, null, 2));

    try {
      const formRoot = await waitForModalForm(page, 5000);
      console.log('waitForModalForm OK, inputs in root:', await formRoot.locator('input').count());
    } catch (e) {
      console.log('waitForModalForm FAILED:', e instanceof Error ? e.message : e);
    }

    await page.waitForTimeout(8000);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
