import { Page } from 'playwright';

const NAME_CANDIDATES = ['input[name*="name" i]', 'input[id*="name" i]', 'input[placeholder*="имя" i]'];
const PHONE_CANDIDATES = [
  'input[name*="phone" i]',
  'input[name="PHONE"]',
  'input[name*="telephone" i]',
  'input[type="tel"]',
  'input[type="phone"]',
  'input[data-phone-pattern]',
  'input[placeholder*="тел" i]',
  'input[placeholder*="+7"]',
  'input[placeholder^="+7"]',
];
const SUBMIT_CANDIDATES = ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Отправить")', 'button:has-text("Submit")'];

async function firstVisibleSelector(page: Page, candidates: string[]): Promise<string | null> {
  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      return selector;
    }
  }

  return null;
}

export async function detectFormSelectors(page: Page): Promise<{
  name_selector: string | null;
  phone_selector: string | null;
  submit_selector: string | null;
}> {
  const name_selector = await firstVisibleSelector(page, NAME_CANDIDATES);
  const phone_selector = await firstVisibleSelector(page, PHONE_CANDIDATES);
  const submit_selector = await firstVisibleSelector(page, SUBMIT_CANDIDATES);

  return { name_selector, phone_selector, submit_selector };
}
