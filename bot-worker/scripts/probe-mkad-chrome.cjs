const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  await page.goto('https://mkad78km.ru/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('gold buttons', await page.locator('button.btn.btn--gold').count());
  await page.locator('button.btn.btn--gold').first().click({ timeout: 10000 });
  await page.waitForTimeout(2500);

  const forms = await page.locator('form').evaluateAll((els) => els.map((el, index) => ({
    index,
    className: el.className,
    id: el.id,
    visible: !!(el.offsetParent || el.getClientRects().length),
    html: el.outerHTML.slice(0, 1200),
  })));

  console.log('FORMS', JSON.stringify(forms, null, 2));

  const visibleForm = page.locator('form.form').filter({ has: page.locator('input[name="phone"]') }).first();
  await visibleForm.locator('input[name="name"]').fill('Тест');
  await visibleForm.locator('input[name="phone"]').fill('9256444444');
  await page.waitForTimeout(5000);

  console.log('iframes', await page.locator('iframe').evaluateAll((els) => els.map((el) => el.src)));
  console.log('smart-token', await page.locator('input[name="smart-token"]').count());

  const captchaNodes = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[class*="aptcha" i], [id*="aptcha" i], [data-testid], script[src*="captcha"]')];
    return nodes.slice(0, 50).map((node) => ({
      tag: node.tagName,
      id: node.id,
      className: String(node.className || '').slice(0, 160),
      testid: node.getAttribute('data-testid'),
      src: node.getAttribute('src'),
    }));
  });

  console.log('CAPTCHA_NODES', JSON.stringify(captchaNodes, null, 2));
  await page.screenshot({ path: 'tmp/mkad-chrome-filled.png', fullPage: false });

  await visibleForm.locator('button[type="submit"]').click().catch(() => undefined);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'tmp/mkad-chrome-after-submit.png', fullPage: false });
  console.log('body', (await page.locator('body').innerText()).slice(0, 1000));

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
