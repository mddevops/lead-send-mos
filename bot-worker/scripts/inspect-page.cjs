const { chromium } = require('playwright');

const url = process.argv[2] ?? 'http://kia-tempavto.ru';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'ru-RU' });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => page.goto(url, { waitUntil: 'load', timeout: 60000 }));
    await page.waitForTimeout(3000);

    const info = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input, textarea, button, a, iframe')].map((el) => ({
        tag: el.tagName,
        type: el.getAttribute('type'),
        name: el.getAttribute('name'),
        id: el.id,
        class: typeof el.className === 'string' ? el.className.slice(0, 80) : '',
        placeholder: el.getAttribute('placeholder'),
        visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
        text: (el.textContent || '').trim().slice(0, 60),
        href: el.getAttribute('href'),
      }));

      const iframes = [...document.querySelectorAll('iframe')].map((f) => ({ src: f.src, id: f.id }));

      return {
        title: document.title,
        forms: document.querySelectorAll('form').length,
        inputs,
        iframes,
        bodySnippet: document.body?.innerHTML?.slice(0, 2000) ?? '',
      };
    });

    console.log(JSON.stringify(info, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
