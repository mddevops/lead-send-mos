import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ locale: 'ru-RU', viewport: { width: 1440, height: 900 } });
  await page.goto('https://carmir-dealer.ru/used/volvo/s80/ii-restailing-2009-2013/845500', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(3500);

  for (const sel of ['.button.button--credit', '.button.trade-in', 'button.offer__page-controls-bottom-callback']) {
    console.log('CLICK', sel, 'count', await page.locator(sel).count());
    await page.locator(sel).first().click({ force: true, timeout: 5000 }).catch((e) => console.log('click err', e.message));
    await page.waitForTimeout(2500);
    const dump = await page.evaluate(`(() => {
      const vis = (el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 2 && r.height > 2;
      };
      const modals = [...document.querySelectorAll('.modal, [class*=modal], [role=dialog], .popup, .fancybox, [class*=Popup]')]
        .filter(vis)
        .map((m) => ({
          cls: String(m.className).slice(0, 120),
          display: getComputedStyle(m).display,
          classes: [...m.classList],
          form: !!m.querySelector('form'),
          inputs: [...m.querySelectorAll('input')].filter(vis).map((i) => ({
            type: i.type, name: i.name, ph: i.placeholder, id: i.id,
          })),
          text: (m.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 220),
        }));
      const phones = [...document.querySelectorAll('input')].filter((i) => vis(i) && /tel|phone|телефон/i.test(i.type + i.name + (i.placeholder || ''))).map((i) => ({
        type: i.type, name: i.name, ph: i.placeholder,
      }));
      return { url: location.href, modals, phones };
    })()`);
    console.log(JSON.stringify(dump, null, 2));
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.locator('.modal__close, .popup__close, [class*=close]').first().click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(600);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
