import { chromium } from 'playwright';

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://comfort-used.ru/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const callback = page.getByText(/обратный звонок/i).first();
  if ((await callback.count()) > 0) {
    await callback.click({ timeout: 8000 });
    await page.waitForTimeout(2000);
  }

  for (const sel of ['[role=dialog]', '.modal', '.fancybox-container', '.popup']) {
    const loc = page.locator(sel);
    const count = await loc.count();
    const visible = count > 0 ? await loc.first().isVisible().catch(() => false) : false;
    console.log(sel, { count, visible });
  }

  const selectors = [
    'input[name*="name" i]',
    'input[name*="phone" i]',
    'input[type="tel"]',
    'button[type="submit"]',
  ];

  for (const sel of selectors) {
    const all = page.locator(sel);
    const n = await all.count();
    for (let i = 0; i < Math.min(n, 3); i++) {
      const el = all.nth(i);
      const visible = await el.isVisible().catch(() => false);
      const name = await el.getAttribute('name');
      const type = await el.getAttribute('type');
      console.log(sel, `#${i}`, { visible, name, type });
    }
  }

  await browser.close();
}

main().catch(console.error);
