process.on('uncaughtException', (error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("reading 'url'") || message.includes('pageError.location')) {
    console.log('IGNORED_PLAYWRIGHT_FIREFOX_BUG', message);
    return;
  }
  console.error('UNCAUGHT', error);
  process.exit(1);
});

/**
 * One-off probe: open mkad78km.ru via Camoufox and try a test lead submit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { closeBrowser, openBrowser } from '../playwright/browser';
import { resolveCaptcha } from '../utils/captchaHandler';
import { navigateToUrl } from '../utils/navigate';
import {
  clickVisible,
  dismissCommonOverlays,
  ensureConsentInForm,
  fieldLocator,
  fillField,
  openFormModal,
  resolveFormRoot,
  waitForModalForm,
} from '../utils/formInteractions';

const mapping = {
  name_selector: 'input[name="name"]',
  phone_selector: 'input[name="phone"]',
  submit_selector: 'button[type="submit"]',
  open_modal_selector: 'button.btn.btn--gold',
  form_scope_selector: 'form.form',
  consent_checkbox_selector: null as string | null,
  captcha_type: 'yandex_smartcaptcha',
  captcha_yandex_mode: 'slider',
  captcha_iframe_selector: 'iframe[src*="smartcaptcha"]',
  captcha_checkbox_selector: '[data-testid="thumb"]',
  captcha_token_selector: 'input[name="smart-token"]',
  wait_after_submit_ms: 3000,
};

async function main(): Promise<void> {
  const outDir = path.resolve(__dirname, '../tmp');
  fs.mkdirSync(outDir, { recursive: true });

  const session = await openBrowser(undefined, {
    headless: false,
    desktopFullScreen: true,
  });
  const page = await session.context.newPage();
  page.on('pageerror', (error) => {
    console.log('PAGE_ERROR', error.message);
  });
  const result: Record<string, unknown> = { engine: session.engine };

  try {
    await navigateToUrl(page, 'https://mkad78km.ru/', { timeoutMs: 60000, retries: 1 });
    result.title = await page.title();
    result.url = page.url();
    console.log('OPENED', result.title);

    await dismissCommonOverlays(page);
    await openFormModal(page, mapping.open_modal_selector);
    await page.waitForTimeout(2500);

    // Wait for captcha iframe if it appears after modal animation
    await page.waitForSelector('iframe[src*="smartcaptcha"], iframe[src*="captcha.yandex"], .SmartCaptcha, [data-testid="thumb"]', {
      timeout: 10000,
    }).catch(() => undefined);

    let formRoot = await waitForModalForm(page).catch(() => null);
    if (!formRoot) {
      formRoot = await resolveFormRoot(page, mapping.form_scope_selector);
    }

    const nameField = fieldLocator(page, mapping, formRoot, mapping.name_selector);
    const phoneField = fieldLocator(page, mapping, formRoot, mapping.phone_selector);
    const submitButton = fieldLocator(page, mapping, formRoot, mapping.submit_selector);

    const iframeSelectors = [
      'iframe[src*="smartcaptcha"]',
      'iframe[src*="captcha.yandex"]',
      'iframe[src*="captcha"]',
    ];
    const iframeInfo: Array<Record<string, unknown>> = [];
    for (const sel of iframeSelectors) {
      const count = await page.locator(sel).count();
      if (count > 0) {
        for (let i = 0; i < Math.min(count, 3); i += 1) {
          const src = await page.locator(sel).nth(i).getAttribute('src').catch(() => null);
          iframeInfo.push({ sel, i, src });
        }
      }
    }

    result.counts = {
      name: await nameField.count(),
      phone: await phoneField.count(),
      submit: await submitButton.count(),
      captchaIframe: await page.locator(mapping.captcha_iframe_selector).count(),
      anyCaptchaIframe: iframeInfo.length,
      advancedCaptcha: await page.locator('.AdvancedCaptcha, .SliderCaptcha, [data-testid="thumb"]').count(),
    };
    result.iframes = iframeInfo;
    console.log('COUNTS', result.counts);
    console.log('IFRAMES', iframeInfo);

    await fillField(nameField, 'Тест Камофокс');
    await fillField(phoneField, '9256444444');
    await ensureConsentInForm(formRoot, mapping.consent_checkbox_selector, null);

    result.filled = {
      name: await nameField.inputValue().catch(() => ''),
      phone: await phoneField.inputValue().catch(() => ''),
    };
    console.log('FILLED', result.filled);

    await page.screenshot({ path: path.join(outDir, 'mkad-before-captcha.png'), fullPage: false });

    try {
      await resolveCaptcha(page, formRoot, {
        captcha_type: mapping.captcha_type,
        captcha_yandex_mode: mapping.captcha_yandex_mode,
        captcha_iframe_selector: mapping.captcha_iframe_selector,
        captcha_checkbox_selector: mapping.captcha_checkbox_selector,
        captcha_token_selector: mapping.captcha_token_selector,
      });
      result.captcha = 'resolved';
    } catch (error) {
      result.captcha = error instanceof Error ? error.message : String(error);
      console.log('CAPTCHA', result.captcha);
      await page.screenshot({ path: path.join(outDir, 'mkad-captcha-fail.png'), fullPage: false });
    }

    const token = await page.locator(mapping.captcha_token_selector).inputValue().catch(() => '');
    result.tokenLength = token.trim().length;
    console.log('TOKEN_LEN', result.tokenLength);

    await page.screenshot({ path: path.join(outDir, 'mkad-before-submit.png'), fullPage: false });

    if (result.captcha === 'resolved' || Number(result.tokenLength) > 0) {
      await clickVisible(submitButton);
      await page.waitForTimeout(mapping.wait_after_submit_ms + 2000);
      result.afterSubmitUrl = page.url();
      result.afterSubmitTitle = await page.title();
      result.bodySnippet = (await page.locator('body').innerText().catch(() => '')).slice(0, 500);
      await page.screenshot({ path: path.join(outDir, 'mkad-after-submit.png'), fullPage: false });
      console.log('SUBMITTED', result.afterSubmitUrl);
    } else {
      result.submitSkipped = true;
      console.log('SUBMIT_SKIPPED — captcha not solved');
    }

    fs.writeFileSync(path.join(outDir, 'mkad-probe-result.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log('RESULT_JSON', JSON.stringify(result, null, 2));
  } finally {
    await page.waitForTimeout(3000);
    await closeBrowser(session);
  }
}

main().catch((error) => {
  console.error('FATAL', error);
  process.exit(1);
});
