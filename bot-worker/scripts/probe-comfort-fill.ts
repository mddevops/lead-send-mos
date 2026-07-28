import { chromium } from 'playwright';
import {
  clickVisible,
  dismissCommonOverlays,
  ensureConsentChecked,
  fillField,
  resolveFormRoot,
} from '../src/utils/formInteractions';

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('https://comfort-used.ru/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismissCommonOverlays(page);

  await page.getByText(/обратный звонок/i).first().click({ timeout: 10000 });
  await page.waitForTimeout(2000);

  const formRoot = await resolveFormRoot(page, '#popup-feedback');
  const rootTag = await (formRoot as { evaluate?: (fn: () => string) => Promise<string> }).evaluate?.(
    (el: Element) => el.tagName + (el.id ? `#${el.id}` : '') + (el.className ? `.${String(el.className).split(' ').join('.')}` : ''),
  ).catch(() => 'page');

  console.log('formRoot', rootTag);

  const name = formRoot.locator('input[name="name"]');
  const phone = formRoot.locator('input[name="telephone"]');
  const submit = formRoot.locator('button[type="submit"]');
  const checkbox = formRoot.locator('label.checkbox input, .checkbox input[type="checkbox"]');

  console.log('counts', {
    name: await name.count(),
    phone: await phone.count(),
    checkbox: await checkbox.count(),
    submit: await submit.count(),
  });

  await fillField(name, 'Тест');
  await fillField(phone, '9256444444');
  await ensureConsentChecked(checkbox);
  console.log('filled name', await name.inputValue());
  console.log('filled phone', await phone.inputValue());
  console.log('checkbox checked', await checkbox.first().isChecked().catch(() => false));

  await page.waitForTimeout(5000);
  await browser.close();
}

main().catch(console.error);
