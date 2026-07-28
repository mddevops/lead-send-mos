/**
 * Quick probe: count forms / phones / CTA on a site homepage.
 * Usage: npx tsx scripts/probe-site-forms-quick.ts https://example.ru
 */
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://example.ru';

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ locale: 'ru-RU', viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);
    const dump = await page.evaluate(`(() => {
      const text = (el) => (el && el.textContent || '').replace(/\\s+/g, ' ').trim();
      const forms = [...document.querySelectorAll('form')].map((f, i) => {
        const r = f.getBoundingClientRect();
        const s = getComputedStyle(f);
        return {
          i,
          visible: r.width > 2 && r.height > 2 && s.display !== 'none' && s.visibility !== 'hidden',
          cls: String(f.className || '').slice(0, 80),
          inputs: [...f.querySelectorAll('input,textarea,select,button,a')].slice(0, 12).map((el) => ({
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type'),
            name: el.getAttribute('name'),
            ph: el.getAttribute('placeholder'),
            text: text(el).slice(0, 40),
            cls: String(el.className || '').slice(0, 60),
          })),
          head: text(f).slice(0, 120),
        };
      });
      const ctas = [...document.querySelectorAll('a, button, [role=button]')]
        .map((el) => ({ text: text(el).slice(0, 60), href: el.getAttribute('href'), tag: el.tagName }))
        .filter((x) => /заявк|звонок|перезвон|кредит|скидк|купить|консульт|записат|подробнее|trade/i.test(x.text))
        .slice(0, 15);
      const phones = document.querySelectorAll('input[type=tel], input[inputmode=tel], input[placeholder*=тел i]').length;
      return { url: location.href, forms: forms.length, visibleForms: forms.filter((f) => f.visible).length, phones, formSamples: forms.filter((f) => f.visible).slice(0, 3), ctas };
    })()`);
    console.log(JSON.stringify({ site: url, ...dump }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
