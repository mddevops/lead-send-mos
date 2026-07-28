const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://kia-tempavto.ru', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3000);

  const form = await page.evaluate(() => {
    const el = document.querySelector('form');
    if (!el) return null;

    return {
      html: el.outerHTML.slice(0, 4000),
      inputs: [...el.querySelectorAll('input')].map((input) => ({
        type: input.type,
        name: input.name,
        id: input.id,
        placeholder: input.placeholder,
        maxLength: input.maxLength,
        autocomplete: input.autocomplete,
        ariaLabel: input.getAttribute('aria-label'),
        parentClass: input.parentElement?.className,
        nearbyText: input.closest('div')?.textContent?.trim().slice(0, 120),
      })),
    };
  });

  console.log(JSON.stringify(form, null, 2));
  await browser.close();
})();
