import { chromium } from 'playwright';
import { getCollectFormsInDocument } from '../src/utils/browserEvaluate';

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'ru-RU', viewport: { width: 1920, height: 1080 } });
  await page.goto('https://avtocompass.ru/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  const info = await page.evaluate(() => {
    return [...document.querySelectorAll('form')].map((form, i) => {
      const buttons = [...form.querySelectorAll('button, input[type=submit]')].map((b) => ({
        type: (b as HTMLButtonElement).type,
        text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        html: b.innerHTML.replace(/\s+/g, ' ').trim().slice(0, 120),
      }));
      const inputs = [...form.querySelectorAll('input')].map((el) => {
        const labelFor = el.id
          ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim().slice(0, 40)
          : null;
        return {
          type: el.type,
          name: el.name,
          id: (el.id || '').slice(0, 50),
          ph: el.placeholder,
          autocomplete: el.autocomplete,
          aria: el.getAttribute('aria-label'),
          labelFor: labelFor || null,
          parentLabel: el.closest('label')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60) || null,
        };
      });
      return { i, className: String(form.className).slice(0, 80), buttons, inputs };
    });
  });

  console.log(JSON.stringify(info, null, 2));
  const raw = await page.evaluate(getCollectFormsInDocument());
  console.log('detected', JSON.stringify(raw, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
