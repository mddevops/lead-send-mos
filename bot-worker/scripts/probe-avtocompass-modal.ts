import { chromium } from 'playwright';
import { getCollectFormsInDocument } from '../src/utils/browserEvaluate';

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'ru-RU', viewport: { width: 1920, height: 1080 } });
  await page.goto('https://avtocompass.ru/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Open callback modal if needed
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('a, button')].find((el) =>
      /перезвоните мне/i.test((el.textContent || '').replace(/\s+/g, ' ')),
    );
    if (btn instanceof HTMLElement) {
      btn.click();
      return true;
    }
    return false;
  });
  console.log('clicked callback button:', clicked);
  await page.waitForTimeout(1500);

  const diag = await page.evaluate(() => {
    const forms = [...document.querySelectorAll('form')];
    return forms.map((form, i) => {
      const style = getComputedStyle(form);
      const parents = [];
      let p: Element | null = form;
      for (let k = 0; k < 6 && p; k++) {
        const s = getComputedStyle(p);
        parents.push({
          tag: p.tagName,
          class: String((p as HTMLElement).className || '').slice(0, 40),
          display: s.display,
          visibility: s.visibility,
          opacity: s.opacity,
          hidden: (p as HTMLElement).hidden,
          ariaHidden: p.getAttribute('aria-hidden'),
        });
        p = p.parentElement;
      }
      return {
        i,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        rect: form.getBoundingClientRect().toJSON(),
        parents,
      };
    });
  });
  console.log('forms visibility:', JSON.stringify(diag, null, 2));

  const raw = await page.evaluate(getCollectFormsInDocument());
  console.log('after click detected:', JSON.stringify(raw, null, 2));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
