import { chromium } from 'playwright';
import { ENTRY_POINT_TEXT_PATTERN, HASH_WIDGET_HREF_PATTERN, STICKY_WIDGET_TEXT_PATTERN, CALLBACK_ENTRY_PATTERN, SERVICE_ENTRY_PATTERN } from '../src/utils/formDetectionConstants';

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ locale: 'ru-RU', viewport: { width: 1440, height: 900 } });
  await page.goto('https://moskvich-tempavto-promo.ru/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  const dump = await page.evaluate(`(() => {
    const HASH_WIDGET_RE = ${HASH_WIDGET_HREF_PATTERN.toString()};
    const PATTERN = ${ENTRY_POINT_TEXT_PATTERN.toString()};
    function isVisible(el) {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }
    const nodes = [...document.querySelectorAll('button, a, [role="button"]')];
    const popup = nodes.filter((el) => (el.getAttribute('href') || '').includes('popup'));
    return {
      totalNodes: nodes.length,
      popupLinks: popup.slice(0, 10).map((el) => ({
        href: el.getAttribute('href'),
        text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60),
        visible: isVisible(el),
        display: getComputedStyle(el).display,
        opacity: getComputedStyle(el).opacity,
        w: el.getBoundingClientRect().width,
        h: el.getBoundingClientRect().height,
        hashOk: HASH_WIDGET_RE.test(el.getAttribute('href') || ''),
        patternOk: PATTERN.test(el.textContent || ''),
      })),
      forms: document.querySelectorAll('form').length,
      inputs: document.querySelectorAll('input').length,
      tildaPopups: document.querySelectorAll('.t-popup, [data-tooltip-hook]').length,
    };
  })()`);
  console.log(JSON.stringify(dump, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
