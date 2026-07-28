import { closeBrowser, openBrowser } from '../playwright/browser';
import { resolveCaptcha } from '../utils/captchaHandler';
import { navigateToUrl } from '../utils/navigate';
import fs from 'node:fs';
import path from 'node:path';

process.on('uncaughtException', (error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("reading 'url'") || message.includes('pageError.location')) {
    console.log('IGNORED_PLAYWRIGHT_BUG', message);
    return;
  }
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  // Force chromium for this probe — Camoufox/Firefox hits Playwright pageerror crash on this site
  process.env.BOT_BROWSER = 'chromium';

  const outDir = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(outDir, { recursive: true });

  const session = await openBrowser(undefined, { headless: false, desktopFullScreen: true });
  const page = await session.context.newPage();
  const result: Record<string, unknown> = { engine: session.engine };

  try {
    await navigateToUrl(page, 'https://mkad78km.ru/', { timeoutMs: 60000, retries: 1 });
    result.title = await page.title();

    const form = page.locator('form.calc__form[data-type="credit"]').first();
    await form.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);

    await form.locator('input[name="name"]').fill('Тест Авто');
    await form.locator('input[name="phone"]').click();
    await form.locator('input[name="phone"]').fill('');
    await form.locator('input[name="phone"]').pressSequentially('9256444444', { delay: 35 });

    await page.waitForSelector('iframe[src*="checkbox"], iframe[data-testid="checkbox-iframe"]', {
      state: 'attached',
      timeout: 15000,
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(outDir, 'mkad-handler-before.png') });

    try {
      await resolveCaptcha(page, form, {
        captcha_type: 'yandex_smartcaptcha',
        captcha_yandex_mode: 'slider',
        captcha_iframe_selector: 'iframe[src*="checkbox"], iframe[data-testid="checkbox-iframe"]',
        captcha_checkbox_selector: '#captcha-slider, [data-testid="thumb"]',
        captcha_token_selector: 'input[name="smart-token"]',
      });
      result.captcha = 'resolved';
    } catch (error) {
      result.captcha = error instanceof Error ? error.message : String(error);
    }

    const token = await page.locator('input[name="smart-token"]').inputValue().catch(() => '');
    result.tokenLength = token.trim().length;
    result.imageCaptcha = await page.locator('.AdvancedCaptcha_image, img[alt="Задание с картинкой"]').first().isVisible().catch(() => false);

    await page.screenshot({ path: path.join(outDir, 'mkad-handler-after-captcha.png') });

    if (token.trim()) {
      await form.locator('button[type="submit"]').click();
      await page.waitForTimeout(4000);
      result.submitted = true;
      result.bodySnippet = (await page.locator('body').innerText()).slice(0, 700);
      await page.screenshot({ path: path.join(outDir, 'mkad-handler-after-submit.png') });
    } else {
      result.submitted = false;
    }

    fs.writeFileSync(path.join(outDir, 'mkad-handler-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await page.waitForTimeout(2500);
    await closeBrowser(session);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
