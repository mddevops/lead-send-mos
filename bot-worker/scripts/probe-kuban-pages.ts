import { chromium } from 'playwright';
const urls = [
  'https://kuban-autohouse.ru/contact/',
  'https://kuban-autohouse.ru/credit/',
  'https://kuban-autohouse.ru/tradein/',
  'https://kuban-autohouse.ru/actions/1/',
  'https://kuban-autohouse.ru/auto/lada/iskra/'
];
async function inspect(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const data = await page.evaluate(() => {
    const forms = [...document.querySelectorAll('form')].map((form, i) => ({
      i,
      text: (form.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220),
      inputs: [...form.querySelectorAll('input, select, textarea, button')].map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el instanceof HTMLInputElement ? el.type : null,
        name: (el as HTMLInputElement).name || null,
        placeholder: (el as HTMLInputElement).placeholder || null,
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        visible: (() => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0; })(),
      })),
    }));
    const ctas = [...document.querySelectorAll('a, button, [role="button"]')]
      .map((el) => ({
        text: ((el.textContent || '') + ' ' + ((el as HTMLElement).getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim().slice(0, 120),
        href: (el as HTMLAnchorElement).href || null,
        visible: (() => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0; })(),
      }))
      .filter((x) => x.visible && /подроб|скидк|заяв|кредит|тест|рассроч|предлож|звон|trade|трейд|отправ|брон|акци|узна/i.test(x.text))
      .slice(0, 20);
    return { forms, ctas };
  });
  return { url, forms: data.forms.length, ctas: data.ctas, samples: data.forms.slice(0, 4) };
}
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'ru-RU', viewport: { width: 1440, height: 900 } });
  try {
    const out = [];
    for (const url of urls) out.push(await inspect(page, url));
    console.log(JSON.stringify(out, null, 2));
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
