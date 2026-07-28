import { chromium } from 'playwright';

const url = process.argv[2] || 'https://carmir-dealer.ru/used/volvo/s80/ii-restailing-2009-2013/845500';

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ locale: 'ru-RU', viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);

  const dump = await page.evaluate(`(() => {
    const text = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim();
    const nodes = [...document.querySelectorAll('a, button, [role=button], div, span')]
      .map((el) => ({
        tag: el.tagName,
        text: text(el).slice(0, 80),
        cls: String(el.className || '').slice(0, 80),
        href: el.getAttribute('href'),
        role: el.getAttribute('role'),
      }))
      .filter((x) => /кредит|trade|обмен|звонок|заявк|купить|предложен/i.test(x.text) && x.text.length < 60)
      .slice(0, 40);
    return { url: location.href, nodes, path: location.pathname };
  })()`);
  console.log(JSON.stringify(dump, null, 2));

  // try click Обратный звонок
  const cb = page.locator('a, button, [role=button]').filter({ hasText: /Обратный звонок/i }).first();
  console.log('callback count', await page.locator('a, button, [role=button]').filter({ hasText: /Обратный звонок/i }).count());
  if (await cb.count()) {
    await cb.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(2000);
    const after = await page.evaluate(`(() => {
      const vis = (el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 2 && r.height > 2;
      };
      const modals = [...document.querySelectorAll('.modal, [class*=modal], [role=dialog], .popup')]
        .filter(vis)
        .map((m) => ({
          cls: String(m.className).slice(0, 120),
          display: getComputedStyle(m).display,
          classes: [...m.classList],
          inputs: [...m.querySelectorAll('input')].filter(vis).map((i) => ({
            type: i.type, name: i.name, ph: i.placeholder, id: i.id, cls: String(i.className).slice(0,40),
          })),
          buttons: [...m.querySelectorAll('button, a.button')].filter(vis).map((b) => (b.innerText||'').trim().slice(0,40)),
        }));
      return { modals };
    })()`);
    console.log('AFTER CALLBACK', JSON.stringify(after, null, 2));
  }

  // try Купить в кредит variants
  for (const re of [/Купить в кредит/i, /кредит/i, /Trade-In/i, /Обмен/i]) {
    const loc = page.locator('a, button, [role=button], .button, [class*=btn]').filter({ hasText: re });
    const n = await loc.count();
    console.log('match', String(re), n);
    if (n > 0) {
      const t = await loc.first().innerText().catch(() => '');
      const tag = await loc.first().evaluate((el) => el.tagName + '.' + el.className).catch(() => '');
      console.log(' first:', JSON.stringify(t), tag);
    }
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
