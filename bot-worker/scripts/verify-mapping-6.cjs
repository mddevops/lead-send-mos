const { chromium } = require('playwright');

const selectors = {
  scope: 'form.grid__col-4',
  name: 'form.grid__col-4 fieldset:nth-of-type(1) > label:nth-of-type(1) > div:nth-of-type(1) > input:nth-of-type(1)',
  phone: 'form.grid__col-4 fieldset:nth-of-type(1) > label:nth-of-type(2) > input:nth-of-type(1)',
  submit: 'button.button--credit',
  consent: 'input[name="checkbox-agree"]',
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  for (const url of [
    'https://xn----7sbg7aste.xn--p1ai/',
    'https://xn----7sbg7aste.xn--p1ai/contacts',
    'https://xn----7sbg7aste.xn--p1ai/credit',
  ]) {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(4000);

    const counts = {};

    for (const [key, selector] of Object.entries(selectors)) {
      counts[key] = await page.locator(selector).count();
    }

    console.log(url, counts);
  }

  await browser.close();
})();
