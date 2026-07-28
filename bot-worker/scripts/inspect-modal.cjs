const { chromium } = require('playwright');

const url = process.argv[2] ?? 'https://yug-avto-haval.ru/models/haval-jolion';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(4000);

  const triggers = page.locator('a, button').filter({ hasText: /заявк|звонок|обратн|консульт|callback|связ/i });
  const count = await triggers.count();
  console.log('triggers:', count);

  for (let i = 0; i < Math.min(count, 5); i++) {
    const t = triggers.nth(i);
    const text = await t.textContent();
    const visible = await t.isVisible().catch(() => false);
    console.log(`trigger ${i}:`, text?.trim(), 'visible:', visible);
    if (visible) {
      await t.click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(2000);
      break;
    }
  }

  const info = await page.evaluate(() => ({
    inputs: [...document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]')].map((el) => ({
      tag: el.tagName,
      type: el.getAttribute('type'),
      name: el.getAttribute('name'),
      id: el.id,
      class: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
      placeholder: el.getAttribute('placeholder'),
      visible: !!(el.offsetWidth || el.offsetHeight),
      nearby: el.closest('form, [class*="form"], [class*="modal"]')?.className?.slice?.(0, 60),
    })),
    forms: document.querySelectorAll('form').length,
    modals: [...document.querySelectorAll('[class*="modal"], [role="dialog"]')].map((m) => ({
      class: m.className?.slice?.(0, 80),
      visible: !!(m.offsetWidth || m.offsetHeight),
      html: m.innerHTML.slice(0, 500),
    })),
  }));

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
