/**
 * Probe why avtocompass.ru forms are not detected.
 * Usage: npx tsx scripts/probe-avtocompass.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { getCollectFormsInDocument } from '../src/utils/browserEvaluate';

const url = process.argv[2] ?? 'https://avtocompass.ru/';

async function main(): Promise<void> {
  mkdirSync('storage', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'ru-RU', viewport: { width: 1920, height: 1080 } });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    const dump = await page.evaluate(() => {
      const forms = [...document.querySelectorAll('form')].map((form, i) => {
        const inputs = [...form.querySelectorAll('input, textarea, button, select')].map((el) => {
          const input = el as HTMLInputElement;
          const rect = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            type: input.type || null,
            name: input.name || null,
            id: input.id || null,
            placeholder: input.placeholder || null,
            className: String(input.className || '').slice(0, 80),
            text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
            visible: rect.width > 0 && rect.height > 0,
            opacity: window.getComputedStyle(el).opacity,
            display: window.getComputedStyle(el).display,
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          };
        });
        const formStyle = window.getComputedStyle(form);
        return {
          i,
          action: form.getAttribute('action'),
          className: String(form.className || '').slice(0, 100),
          id: form.id || null,
          formDisplay: formStyle.display,
          formVisibility: formStyle.visibility,
          formOpacity: formStyle.opacity,
          formW: Math.round(form.getBoundingClientRect().width),
          formH: Math.round(form.getBoundingClientRect().height),
          inputs,
        };
      });

      const phones = [...document.querySelectorAll('input')].filter((el) => {
        const t = `${el.type} ${el.name} ${el.placeholder} ${el.className} ${el.id}`;
        return /tel|phone|телефон|\+7|mask/i.test(t);
      }).map((el) => ({
        type: el.type,
        name: el.name,
        id: el.id,
        placeholder: el.placeholder,
        className: String(el.className).slice(0, 80),
        visible: el.getBoundingClientRect().width > 0,
        opacity: window.getComputedStyle(el).opacity,
      }));

      return {
        title: document.title,
        formCount: document.querySelectorAll('form').length,
        forms,
        phones,
        callbackButtons: [...document.querySelectorAll('a, button')].filter((el) =>
          /перезвон|заявк|обратн/i.test(el.textContent || ''),
        ).slice(0, 10).map((el) => ({
          tag: el.tagName,
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
          href: (el as HTMLAnchorElement).href || null,
        })),
      };
    });

    const collector = getCollectFormsInDocument();
    const raw = await page.evaluate(collector);

    const out = { url, dump, raw };
    writeFileSync('storage/probe-avtocompass.json', JSON.stringify(out, null, 2), 'utf8');
    console.log('Wrote storage/probe-avtocompass.json');
    console.log('forms in DOM:', dump.formCount, 'phones:', dump.phones.length);
    console.log('detector forms:', raw.forms.length, 'phonesSeen:', raw.phonesSeen, 'formsScanned:', raw.formsScanned);
    console.log('raw forms:', JSON.stringify(raw.forms, null, 2));
    console.log('phone fields:', JSON.stringify(dump.phones, null, 2));
    for (const form of dump.forms) {
      console.log(`form[${form.i}] display=${form.formDisplay} opacity=${form.formOpacity} size=${form.formW}x${form.formH} class=${form.className}`);
      for (const input of form.inputs) {
        console.log(`  ${input.tag} type=${input.type} name=${input.name} ph=${input.placeholder} visible=${input.visible} op=${input.opacity}`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
