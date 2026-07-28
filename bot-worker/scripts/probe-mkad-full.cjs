const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function main() {
  const outDir = path.resolve(__dirname, '../tmp');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const result = { engine: 'chromium' };

  try {
    await page.goto('https://mkad78km.ru/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    result.title = await page.title();

    // Credit form is already on page — do not click random gold buttons
    const form = page.locator('form.calc__form[data-type="credit"]').first();
    await form.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);

    await form.locator('input[name="name"]').fill('Тест Авто');
    await form.locator('input[name="phone"]').click();
    await form.locator('input[name="phone"]').fill('');
    await form.locator('input[name="phone"]').type('9256444444', { delay: 40 });
    await page.waitForTimeout(4000);

    const iframeSrcs = await page.locator('iframe').evaluateAll((els) => els.map((el) => el.src));
    result.iframes = iframeSrcs;
    result.tokenBefore = await page.locator('input[name="smart-token"]').inputValue().catch(() => '');

    await page.screenshot({ path: path.join(outDir, 'mkad-full-before-captcha.png') });

    // Click Yandex checkbox inside iframe
    const checkboxFrame = page.frameLocator('iframe[src*="checkbox"]');
    const checkbox = checkboxFrame.locator('[role="checkbox"], .CheckboxCaptcha-Button, .CheckboxCaptcha-Anchor').first();
    const checkboxVisible = await checkbox.isVisible().catch(() => false);
    result.checkboxVisible = checkboxVisible;

    if (checkboxVisible) {
      await checkbox.click({ timeout: 8000 });
      await page.waitForTimeout(3000);
    }

    // Detect image captcha
    const imageVisible = await page.locator('.AdvancedCaptcha_image, img[alt="Задание с картинкой"]').first().isVisible().catch(() => false);
    result.imageCaptcha = imageVisible;

    // Detect slider
    const sliderVisible = await page.frameLocator('iframe[src*="smartcaptcha"], iframe[src*="captcha"]').locator('#captcha-slider, [data-testid="thumb"]').first().isVisible().catch(() => false);
    result.sliderVisible = sliderVisible;

    // Wait briefly for token
    let token = '';
    for (let i = 0; i < 20; i += 1) {
      token = await page.locator('input[name="smart-token"]').inputValue().catch(() => '');
      if (token.trim()) break;
      await page.waitForTimeout(500);
    }
    result.tokenLength = token.trim().length;

    await page.screenshot({ path: path.join(outDir, 'mkad-full-after-captcha.png') });

    if (token.trim()) {
      await form.locator('button[type="submit"]').click();
      await page.waitForTimeout(4000);
      result.submitted = true;
      result.bodySnippet = (await page.locator('body').innerText()).slice(0, 600);
      await page.screenshot({ path: path.join(outDir, 'mkad-full-after-submit.png') });
    } else {
      result.submitted = false;
      result.reason = imageVisible
        ? 'После галочки показан текст с картинки — без ruCaptcha ключа не решается'
        : 'Токен smart-token пустой';
    }

    fs.writeFileSync(path.join(outDir, 'mkad-full-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
