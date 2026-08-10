import pino from 'pino';
import { FrameLocator, Locator, Page } from 'playwright';
import { captchaSolverAvailable, solveCaptchaImageBase64, solveYandexSmartCaptchaCoordinates, solveYandexSmartCaptchaToken } from './captchaSolver';
import { humanIdleJitter } from './humanMouse';

const logger = pino({ name: 'captcha-handler' });

export type CaptchaType = 'none' | 'yandex_smartcaptcha' | 'google_recaptcha_v2' | 'hcaptcha';
export type YandexCaptchaMode = 'checkbox' | 'slider';

export type CaptchaConfig = {
  captcha_type?: CaptchaType | string | null;
  captcha_yandex_mode?: YandexCaptchaMode | string | null;
  captcha_iframe_selector?: string | null;
  captcha_checkbox_selector?: string | null;
  captcha_token_selector?: string | null;
};

export type ResolveCaptchaOptions = {
  /**
   * How long to wait for captcha UI to appear.
   * Pre-submit: 2000ms. Post-submit: ~5000ms.
   */
  appearTimeoutMs?: number;
  /**
   * Allow slow method=yandex without a visible interactive challenge.
   * Never enable on pre-submit — it adds 20–60s delay.
   */
  allowBlindTokenSolve?: boolean;
  /** pre-submit: quick skip. post-submit: solve slider/image that appears after click. */
  phase?: 'pre-submit' | 'post-submit';
};

type CaptchaDefaults = {
  iframeSelectors: string[];
  checkboxSelectors: string[];
  sliderThumbSelectors: string[];
  sliderTrackSelectors: string[];
  tokenSelectors: string[];
};

const CAPTCHA_DEFAULTS: Record<Exclude<CaptchaType, 'none'>, CaptchaDefaults> = {
  yandex_smartcaptcha: {
    iframeSelectors: [
      'iframe[data-testid="advanced-iframe"]',
      'iframe[data-testid="checkbox-iframe"]',
      'iframe[src*="checkbox"]',
      'iframe[src*="smartcaptcha"]',
      'iframe[src*="captcha.yandex"]',
    ],
    checkboxSelectors: [
      '#js-button',
      '.CheckboxCaptcha-Button',
      '.CheckboxCaptcha-Anchor',
      'input.CheckboxCaptcha-Button[role="checkbox"]',
      '[data-testid="checkbox-captcha"] [role="checkbox"]',
    ],
    sliderThumbSelectors: [
      '#captcha-slider',
      '[data-testid="thumb"]',
      '.CaptchaSlider .Thumb',
      '.Thumb[role="slider"]',
    ],
    sliderTrackSelectors: [
      '.Track',
      '[data-testid="slider"]',
      '.CaptchaSlider',
    ],
    tokenSelectors: ['input[name="smart-token"]', 'input[data-testid="smart-token"]'],
  },
  google_recaptcha_v2: {
    iframeSelectors: [
      'iframe[src*="google.com/recaptcha/api2/anchor"]',
      'iframe[title*="reCAPTCHA"]',
    ],
    checkboxSelectors: ['#recaptcha-anchor', '.recaptcha-checkbox-border', '[role="checkbox"]'],
    sliderThumbSelectors: [],
    sliderTrackSelectors: [],
    tokenSelectors: ['textarea[name="g-recaptcha-response"]', '#g-recaptcha-response'],
  },
  hcaptcha: {
    iframeSelectors: ['iframe[src*="hcaptcha.com/captcha"]', 'iframe[src*="hcaptcha.com"]'],
    checkboxSelectors: ['#checkbox', '[role="checkbox"]', 'div#anchor-state'],
    sliderThumbSelectors: [],
    sliderTrackSelectors: [],
    tokenSelectors: ['textarea[name="h-captcha-response"]', 'input[name="h-captcha-response"]'],
  },
};

type ImageCaptchaElements = {
  root: Page | FrameLocator;
  image: Locator;
  input: Locator;
  submit: Locator;
};

type SliderElements = {
  root: Page | FrameLocator;
  thumb: Locator;
  track: Locator;
};

type SliderSolveResult = 'image' | 'dragged' | 'not_found';

function normalizeCaptchaType(value?: CaptchaType | string | null): CaptchaType {
  if (!value || value === 'none') {
    return 'none';
  }

  if (value in CAPTCHA_DEFAULTS) {
    return value as CaptchaType;
  }

  return 'none';
}

function normalizeYandexMode(value?: YandexCaptchaMode | string | null): YandexCaptchaMode {
  return value === 'slider' ? 'slider' : 'checkbox';
}

function randomPause(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

async function waitForToken(page: Page, formRoot: Locator, tokenSelectors: string[], timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const selector of tokenSelectors) {
      const inForm = formRoot.locator(selector).first();
      const onPage = page.locator(selector).first();
      const locator = (await inForm.count()) > 0 ? inForm : onPage;

      if ((await locator.count()) === 0) {
        continue;
      }

      const tagName = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');

      if (tagName === 'textarea') {
        const text = await locator.inputValue().catch(() => '');

        if (text.trim().length > 0) {
          return true;
        }
      } else {
        const value = await locator.inputValue().catch(() => '');

        if (value.trim().length > 0) {
          return true;
        }
      }
    }

    if (timeoutMs <= 0) {
      break;
    }

    await page.waitForTimeout(Math.min(500, Math.max(0, deadline - Date.now())));
  }

  return false;
}

/** Fast check: token already filled (no polling delay). */
async function hasCaptchaToken(page: Page, formRoot: Locator, tokenSelectors: string[]): Promise<boolean> {
  return waitForToken(page, formRoot, tokenSelectors, 0);
}

async function findImageCaptchaOnRoot(root: Page | FrameLocator): Promise<ImageCaptchaElements | null> {
  const input = root.locator('input.Textinput-Control[name="rep"], input[name="rep"].Textinput-Control').first();
  const container = root.locator('.AdvancedCaptcha_image, .AdvancedCaptcha.AdvancedCaptcha_image').first();

  const inputVisible = (await input.count()) > 0 && (await input.isVisible().catch(() => false));
  const containerVisible = (await container.count()) > 0 && (await container.isVisible().catch(() => false));

  if (!inputVisible && !containerVisible) {
    return null;
  }

  const image = root.locator('.AdvancedCaptcha-View img, img[alt="Задание с картинкой"]').first();
  const submit = root.locator('button[data-testid="submit"]').first();

  if ((await image.count()) === 0 || (await input.count()) === 0 || (await submit.count()) === 0) {
    return null;
  }

  if (!(await image.isVisible().catch(() => false)) || !(await submit.isVisible().catch(() => false))) {
    return null;
  }

  return { root, image, input, submit };
}

async function findImageCaptcha(page: Page, iframeSelectors: string[]): Promise<ImageCaptchaElements | null> {
  const onPage = await findImageCaptchaOnRoot(page);

  if (onPage) {
    return onPage;
  }

  const framesToTry = iframeSelectors.length > 0 ? iframeSelectors : ['iframe'];

  for (const iframeSelector of framesToTry) {
    const iframeCount = await page.locator(iframeSelector).count();

    for (let index = 0; index < Math.min(iframeCount, 3); index += 1) {
      const frame = page.frameLocator(iframeSelector).nth(index);
      const inFrame = await findImageCaptchaOnRoot(frame);

      if (inFrame) {
        return inFrame;
      }
    }
  }

  return null;
}

async function isImageCaptchaVisible(page: Page, iframeSelectors: string[]): Promise<boolean> {
  return (await findImageCaptcha(page, iframeSelectors)) !== null;
}

async function extractCaptchaImageBase64(image: Locator): Promise<string> {
  const imageSrc = await image.getAttribute('src').catch(() => null);

  if (imageSrc?.startsWith('data:image')) {
    const base64 = imageSrc.split(',')[1];

    if (base64 && base64.length > 100) {
      logger.info({ bytes: base64.length }, 'Captcha image taken from data URL');

      return base64;
    }
  }

  if (imageSrc?.startsWith('http')) {
    try {
      const response = await image.page().request.get(imageSrc, { timeout: 15000 });

      if (response.ok()) {
        const buffer = await response.body();

        if (buffer.length > 100) {
          logger.info({ bytes: buffer.length }, 'Captcha image loaded by URL');

          return buffer.toString('base64');
        }
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to load captcha image by URL, using screenshot');
    }
  }

  // Animated captcha widgets often never become "stable" for Playwright screenshot.
  try {
    const imageBuffer = await image.screenshot({
      timeout: 4000,
      animations: 'disabled',
    });

    logger.info({ bytes: imageBuffer.length }, 'Captcha image captured by screenshot');

    return imageBuffer.toString('base64');
  } catch (error) {
    logger.warn({ error }, 'Element screenshot failed, trying page crop');
  }

  const box = await image.boundingBox().catch(() => null);

  if (box && box.width >= 8 && box.height >= 8) {
    const pageBuffer = await image.page().screenshot({
      timeout: 5000,
      animations: 'disabled',
      clip: {
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: Math.ceil(box.width),
        height: Math.ceil(box.height),
      },
    });

    logger.info({ bytes: pageBuffer.length }, 'Captcha image captured by page crop');

    return pageBuffer.toString('base64');
  }

  throw new Error('Unable to capture captcha image (unstable element)');
}

async function typeLikeHuman(input: Locator, text: string): Promise<void> {
  await input.click({ timeout: 5000 });
  await input.fill('');
  await input.page().waitForTimeout(randomPause(200, 450));

  for (const char of text) {
    await input.pressSequentially(char, { delay: randomPause(70, 180) });
  }

  await input.page().waitForTimeout(randomPause(300, 600));
}

async function solveYandexImageCaptcha(
  page: Page,
  formRoot: Locator,
  iframeSelectors: string[],
  tokenSelectors: string[],
  maxAttempts = 2,
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Already passed while a previous attempt / poll was in flight.
    if (await hasCaptchaToken(page, formRoot, tokenSelectors) || await isYandexCheckboxPassed(page, iframeSelectors)) {
      logger.info({ attempt }, 'Image captcha: already verified — stop');
      return true;
    }

    const challenge = await findImageCaptcha(page, iframeSelectors);

    if (!challenge) {
      return await hasCaptchaToken(page, formRoot, tokenSelectors)
        || await isYandexCheckboxPassed(page, iframeSelectors);
    }

    logger.info({ attempt }, 'Yandex image captcha detected, solving');

    let imageBase64: string;

    try {
      imageBase64 = await extractCaptchaImageBase64(challenge.image);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ attempt, message }, 'Captcha image capture failed — retrying or aborting image solve');
      continue;
    }

    // Page-crop of a disappearing widget is ~300 bytes garbage — do not burn RuCaptcha on it.
    if (imageBase64.length < 1500) {
      logger.warn({ attempt, bytes: imageBase64.length }, 'Captcha image too small — skip send to solver');
      if (await hasCaptchaToken(page, formRoot, tokenSelectors) || await isYandexCheckboxPassed(page, iframeSelectors)) {
        return true;
      }
      await page.waitForTimeout(400);
      continue;
    }

    let solution: string;

    try {
      solution = await solveCaptchaImageBase64(imageBase64);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ message }, 'Image captcha solver failed');
      if (await hasCaptchaToken(page, formRoot, tokenSelectors) || await isYandexCheckboxPassed(page, iframeSelectors)) {
        logger.info({ attempt }, 'Solver failed but captcha already verified — treat as solved');
        return true;
      }
      continue;
    }

    logger.info({ attempt, solutionLength: solution.length, solution }, 'Typing captcha solution into form');

    await typeLikeHuman(challenge.input, solution);
    await challenge.submit.click({ timeout: 8000 });

    // Text captcha often leaves no smart-token in DOM — success = UI gone / checkbox verified.
    const settleDeadline = Date.now() + 2500;
    while (Date.now() < settleDeadline) {
      if (await hasCaptchaToken(page, formRoot, tokenSelectors)) {
        logger.info({ attempt }, 'Image captcha: token ready');
        return true;
      }

      if (await isYandexCheckboxPassed(page, iframeSelectors)) {
        logger.info({ attempt }, 'Image captcha: checkbox verified after submit');
        return true;
      }

      if (!(await isImageCaptchaVisible(page, iframeSelectors))) {
        logger.info({ attempt }, 'Image captcha UI gone after submit — treated as solved');
        return true;
      }

      await page.waitForTimeout(200);
    }

    if (await isImageCaptchaVisible(page, iframeSelectors)) {
      if (await hasCaptchaToken(page, formRoot, tokenSelectors) || await isYandexCheckboxPassed(page, iframeSelectors)) {
        return true;
      }
      logger.warn({ attempt }, 'Image captcha still visible — retry');
      continue;
    }

    logger.info({ attempt }, 'Image captcha cleared');
    return true;
  }

  return await hasCaptchaToken(page, formRoot, tokenSelectors)
    || await isYandexCheckboxPassed(page, iframeSelectors);
}

async function extractYandexSitekey(page: Page): Promise<string | null> {
  const fromIframe = await page.locator('iframe[src*="sitekey="]').first().getAttribute('src').catch(() => null);

  if (fromIframe) {
    const match = fromIframe.match(/[?&]sitekey=([^&]+)/i);

    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }

  const fromDom = await page.evaluate(() => {
    const container = document.querySelector('[data-sitekey], .smart-captcha[data-sitekey], .SmartCaptcha');
    const attr = container?.getAttribute('data-sitekey');

    if (attr) {
      return attr;
    }

    const script = [...document.querySelectorAll('script')].map((node) => node.textContent || '').join('\n');
    const match = script.match(/sitekey["'\s:=]+["']?(ysc1_[A-Za-z0-9_-]+)/i);

    return match?.[1] ?? null;
  }).catch(() => null);

  return fromDom;
}

async function injectSmartToken(page: Page, formRoot: Locator, token: string, tokenSelectors: string[]): Promise<void> {
  for (const selector of tokenSelectors) {
    const inForm = formRoot.locator(selector).first();
    const onPage = page.locator(selector).first();
    const locator = (await inForm.count()) > 0 ? inForm : onPage;

    if ((await locator.count()) === 0) {
      continue;
    }

    await locator.evaluate((el, value) => {
      const input = el as HTMLInputElement;
      input.value = value;
      input.setAttribute('value', value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, token);

    logger.info({ selector, tokenLength: token.length }, 'Injected smart-token');

    return;
  }

  // Create hidden input if site expects it but field is missing
  await page.evaluate((value) => {
    let input = document.querySelector('input[name="smart-token"]') as HTMLInputElement | null;

    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'smart-token';
      document.body.appendChild(input);
    }

    input.value = value;
  }, token);
}

async function trySolveViaRucaptchaToken(
  page: Page,
  formRoot: Locator,
  tokenSelectors: string[],
): Promise<boolean> {
  if (!captchaSolverAvailable()) {
    return false;
  }

  const sitekey = await extractYandexSitekey(page);

  if (!sitekey) {
    logger.warn('Yandex sitekey not found for token method');

    return false;
  }

  try {
    const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => undefined);
    const token = await solveYandexSmartCaptchaToken({
      sitekey,
      pageurl: page.url(),
      userAgent,
    });

    await injectSmartToken(page, formRoot, token, tokenSelectors);

    return waitForToken(page, formRoot, tokenSelectors, 3000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ message, sitekey }, 'ruCaptcha Yandex token method failed');

    return false;
  }
}

async function trySolveYandexImageOrToken(
  page: Page,
  formRoot: Locator,
  iframeSelectors: string[],
  tokenSelectors: string[],
): Promise<boolean> {
  if (await waitForToken(page, formRoot, tokenSelectors, 1500)) {
    return true;
  }

  if (await isImageCaptchaVisible(page, iframeSelectors)) {
    return solveYandexImageCaptcha(page, formRoot, iframeSelectors, tokenSelectors);
  }

  return false;
}

async function clickCaptchaCheckbox(page: Page, iframeSelectors: string[], checkboxSelectors: string[]): Promise<boolean> {
  const allSelectors = [...new Set([...YANDEX_CHECKBOX_SELECTORS, ...checkboxSelectors])];

  // Already verified (text/icons done) — do NOT re-click #js-button (type=submit).
  if (await isYandexCheckboxPassed(page, iframeSelectors)) {
    logger.info('Captcha checkbox already verified — skip click');
    return true;
  }

  // 1) Page-level first — showcaptcha renders CheckboxCaptcha without iframe.
  for (const checkboxSelector of allSelectors) {
    const checkbox = page.locator(checkboxSelector).first();

    if ((await checkbox.count()) === 0) {
      continue;
    }

    // SmartCaptcha may report opacity:0 — still click if it has a box.
    const box = await checkbox.boundingBox().catch(() => null);
    if (!box || box.width < 4 || box.height < 4) {
      if (!(await checkbox.isVisible().catch(() => false))) {
        continue;
      }
    }

    await checkbox.scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(randomPause(400, 900));

    logger.info({ checkboxSelector, url: page.url() }, 'Clicking page-level Yandex checkbox');

    await checkbox.click({ timeout: 8000, force: true }).catch(() => undefined);
    await page.waitForTimeout(randomPause(800, 1500));

    return true;
  }

  // 2) Checkbox inside captcha iframes (embedded SmartCaptcha widgets).
  const framesToTry = [
    ...iframeSelectors,
    ...YANDEX_CHECKBOX_IFRAME_SELECTORS,
    'iframe',
  ];

  for (const iframeSelector of [...new Set(framesToTry)]) {
    const iframeCount = await page.locator(iframeSelector).count();

    for (let index = 0; index < Math.min(iframeCount, 3); index += 1) {
      const frame = page.frameLocator(iframeSelector).nth(index);

      for (const checkboxSelector of allSelectors) {
        const checkbox = frame.locator(checkboxSelector).first();

        if ((await checkbox.count()) === 0) {
          continue;
        }

        await checkbox.scrollIntoViewIfNeeded().catch(() => undefined);
        await page.waitForTimeout(randomPause(300, 700));
        await checkbox.click({ timeout: 8000, force: true }).catch(() => undefined);
        await page.waitForTimeout(1200);

        logger.info({ iframeSelector, checkboxSelector }, 'Clicked captcha checkbox in iframe');

        return true;
      }
    }
  }

  // 3) Direct frame.evaluate click — bypasses Playwright visibility/opacity gates.
  for (const frame of page.frames()) {
    if (!/smartcaptcha|captcha\.yandex|checkbox/i.test(frame.url())) {
      continue;
    }

    const clicked = await frame.evaluate(() => {
      const btn = document.querySelector(
        '#js-button, .CheckboxCaptcha-Button, [role="checkbox"], input.CheckboxCaptcha-Button',
      ) as HTMLElement | null;
      if (!btn) {
        return false;
      }
      if (btn.getAttribute('aria-checked') === 'true') {
        return 'already';
      }
      btn.click();
      return true;
    }).catch(() => false);

    if (clicked === 'already' || clicked === true) {
      logger.info({ frameUrl: frame.url().slice(0, 120), clicked }, 'Captcha checkbox clicked via frame.evaluate');
      await page.waitForTimeout(1200);
      return true;
    }
  }

  return false;
}

type IconsCaptchaElements = {
  root: Page | FrameLocator;
  page: Page;
  mainImage: Locator;
  instruction: Locator;
  submit: Locator;
};

async function findIconsCaptchaOnRoot(page: Page, root: Page | FrameLocator): Promise<IconsCaptchaElements | null> {
  const silhouette = root.locator(
    '.AdvancedCaptcha-SilhouetteTask, [class*="SilhouetteTask"], .AdvancedCaptcha_silhouette',
  ).first();
  const mainImage = root.locator(YANDEX_ICONS_SELECTORS.mainImage).first();
  const instruction = root.locator(YANDEX_ICONS_SELECTORS.instruction).first();
  const submit = root.locator(YANDEX_ICONS_SELECTORS.submit).first();

  const hasSilhouette = (await silhouette.count()) > 0 && (await silhouette.isVisible().catch(() => false));
  const hasImage = (await mainImage.count()) > 0 && (await mainImage.isVisible().catch(() => false));
  // Text-input image captcha is a different flow — skip if rep input is present.
  const hasTextInput = (await root.locator('input[name="rep"]').count()) > 0
    && (await root.locator('input[name="rep"]').first().isVisible().catch(() => false));

  if (hasTextInput) {
    return null;
  }

  if (!hasImage && !hasSilhouette) {
    return null;
  }

  if (!hasImage) {
    return null;
  }

  const instructionEl = (await instruction.count()) > 0 ? instruction : silhouette;

  if ((await instructionEl.count()) === 0) {
    return null;
  }

  return {
    root,
    page,
    mainImage,
    instruction: instructionEl,
    submit,
  };
}

async function findIconsCaptcha(page: Page, iframeSelectors: string[]): Promise<IconsCaptchaElements | null> {
  const onPage = await findIconsCaptchaOnRoot(page, page);

  if (onPage) {
    return onPage;
  }

  const framesToTry = [
    YANDEX_ICONS_SELECTORS.advancedIframe,
    ...iframeSelectors,
    'iframe',
  ];

  for (const iframeSelector of [...new Set(framesToTry)]) {
    const iframeCount = await page.locator(iframeSelector).count();

    for (let index = 0; index < Math.min(iframeCount, 3); index += 1) {
      const frame = page.frameLocator(iframeSelector).nth(index);
      const inFrame = await findIconsCaptchaOnRoot(page, frame);

      if (inFrame) {
        return inFrame;
      }
    }
  }

  return null;
}

async function isIconsCaptchaVisible(page: Page, iframeSelectors: string[]): Promise<boolean> {
  return (await findIconsCaptcha(page, iframeSelectors)) !== null;
}

async function extractLocatorImageBase64(locator: Locator): Promise<string> {
  const tag = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');

  if (tag === 'canvas') {
    const dataUrl = await locator.evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      try {
        return canvas.toDataURL('image/png');
      } catch {
        return '';
      }
    }).catch(() => '');

    if (dataUrl.startsWith('data:image')) {
      const base64 = dataUrl.split(',')[1] || '';
      if (base64.length > 100) {
        return base64;
      }
    }
  }

  if (tag === 'img') {
    return extractCaptchaImageBase64(locator);
  }

  // Container: prefer nested img/canvas, else screenshot the box.
  const nestedImg = locator.locator('img').first();
  if ((await nestedImg.count()) > 0) {
    return extractCaptchaImageBase64(nestedImg);
  }

  const nestedCanvas = locator.locator('canvas').first();
  if ((await nestedCanvas.count()) > 0) {
    return extractLocatorImageBase64(nestedCanvas);
  }

  const buffer = await locator.screenshot({
    timeout: 5000,
    animations: 'disabled',
  });

  return buffer.toString('base64');
}

async function clickCoordinatesOnImage(
  page: Page,
  image: Locator,
  coordinates: Array<{ x: number; y: number }>,
): Promise<void> {
  const box = await image.boundingBox();

  if (!box) {
    throw new Error('Не удалось получить размеры изображения капчи для кликов');
  }

  // Solver returns coords for the natural image size; scale to rendered box.
  const natural = await image.evaluate((el) => {
    if (el instanceof HTMLImageElement) {
      return { width: el.naturalWidth || el.width, height: el.naturalHeight || el.height };
    }
    if (el instanceof HTMLCanvasElement) {
      return { width: el.width, height: el.height };
    }
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }).catch(() => ({ width: box.width, height: box.height }));

  const scaleX = natural.width > 0 ? box.width / natural.width : 1;
  const scaleY = natural.height > 0 ? box.height / natural.height : 1;

  logger.info(
    {
      clicks: coordinates.length,
      box,
      natural,
      scaleX,
      scaleY,
    },
    'Clicking SmartCaptcha icon coordinates',
  );

  for (const point of coordinates) {
    const clickX = box.x + point.x * scaleX;
    const clickY = box.y + point.y * scaleY;
    await page.mouse.click(clickX, clickY);
    await page.waitForTimeout(randomPause(350, 700));
  }
}

async function solveYandexIconsCaptcha(
  page: Page,
  formRoot: Locator,
  iframeSelectors: string[],
  tokenSelectors: string[],
  maxAttempts = 2,
): Promise<boolean> {
  if (!captchaSolverAvailable()) {
    logger.warn('Icons captcha visible but CAPTCHA_SOLVER is disabled');

    return false;
  }

  let lastSolverError: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const challenge = await findIconsCaptcha(page, iframeSelectors);

    if (!challenge) {
      return false;
    }

    logger.info({ attempt, url: page.url() }, 'Yandex icons/silhouette captcha detected, solving');

    let bodyBase64: string;
    let instructionsBase64: string;

    try {
      bodyBase64 = await extractLocatorImageBase64(challenge.mainImage);
      instructionsBase64 = await extractLocatorImageBase64(challenge.instruction);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ attempt, message }, 'Failed to capture icons captcha images');
      lastSolverError = message;
      continue;
    }

    let coordinates: Array<{ x: number; y: number }>;

    try {
      coordinates = await solveYandexSmartCaptchaCoordinates({
        bodyBase64,
        instructionsBase64,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastSolverError = message;
      logger.error({ message, attempt }, 'Icons captcha solver failed');

      // Balance / auth errors will not recover on retry.
      if (/ERROR_ZERO_BALANCE|ERROR_KEY_DOES_NOT_EXIST|ERROR_WRONG_USER_KEY|ERROR_IP_NOT_ALLOWED/i.test(message)) {
        throw new Error(message);
      }

      continue;
    }

    try {
      await clickCoordinatesOnImage(challenge.page, challenge.mainImage, coordinates);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ message, attempt }, 'Failed to click icon coordinates');
      continue;
    }

    if ((await challenge.submit.count()) > 0 && (await challenge.submit.isVisible().catch(() => false))) {
      await page.waitForTimeout(randomPause(400, 800));
      await challenge.submit.click({ timeout: 8000 }).catch(() => undefined);
    }

    await page.waitForTimeout(randomPause(2000, 3500));

    // Success: left showcaptcha / challenge gone / token present / back on search.
    if (!/showcaptcha|checkcaptcha/i.test(page.url()) && /\/search\//i.test(page.url())) {
      logger.info({ attempt }, 'Icons captcha solved — redirected to search');

      return true;
    }

    if (await waitForToken(page, formRoot, tokenSelectors, 5000)) {
      return true;
    }

    if (!(await isIconsCaptchaVisible(page, iframeSelectors))) {
      logger.info({ attempt }, 'Icons captcha UI disappeared after clicks');

      return true;
    }
  }

  if (lastSolverError) {
    throw new Error(lastSolverError);
  }

  return false;
}

async function getSliderProgress(thumb: Locator): Promise<number> {
  const ariaValue = await thumb.getAttribute('aria-valuenow').catch(() => null);

  if (ariaValue !== null) {
    return Number.parseInt(ariaValue, 10) || 0;
  }

  const repInput = thumb.locator('input[name="rep"]').first();

  if ((await repInput.count()) > 0) {
    const value = await repInput.inputValue().catch(() => '0');

    return Number.parseInt(value, 10) || 0;
  }

  return 0;
}

async function findTrackForThumb(frame: Page | FrameLocator, thumb: Locator, trackSelectors: string[]): Promise<Locator | null> {
  for (const trackSelector of trackSelectors) {
    const candidate = frame.locator(trackSelector).first();

    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      return candidate;
    }
  }

  const ancestorTrack = thumb.locator('xpath=ancestor::*[contains(@class,"Track")][1]').first();

  if ((await ancestorTrack.count()) > 0) {
    return ancestorTrack;
  }

  const sliderRoot = thumb.locator('xpath=ancestor::*[contains(@class,"CaptchaSlider")][1]').first();

  if ((await sliderRoot.count()) > 0) {
    const innerTrack = sliderRoot.locator('.Track').first();

    if ((await innerTrack.count()) > 0) {
      return innerTrack;
    }
  }

  return null;
}

async function findSliderOnRoot(
  root: Page | FrameLocator,
  thumbSelectors: string[],
  trackSelectors: string[],
): Promise<Pick<SliderElements, 'thumb' | 'track'> | null> {
  for (const thumbSelector of thumbSelectors) {
    const thumb = root.locator(thumbSelector).first();

    if ((await thumb.count()) === 0 || !(await thumb.isVisible().catch(() => false))) {
      continue;
    }

    const track = await findTrackForThumb(root, thumb, trackSelectors);

    if (!track) {
      continue;
    }

    return { thumb, track };
  }

  return null;
}

async function findSliderElements(
  page: Page,
  iframeSelectors: string[],
  thumbSelectors: string[],
  trackSelectors: string[],
): Promise<SliderElements | null> {
  const onPage = await findSliderOnRoot(page, thumbSelectors, trackSelectors);

  if (onPage) {
    return { root: page, ...onPage };
  }

  const framesToTry = iframeSelectors.length > 0 ? iframeSelectors : ['iframe'];

  for (const iframeSelector of framesToTry) {
    const iframeCount = await page.locator(iframeSelector).count();

    for (let index = 0; index < Math.min(iframeCount, 3); index += 1) {
      const frame = page.frameLocator(iframeSelector).nth(index);
      const inFrame = await findSliderOnRoot(frame, thumbSelectors, trackSelectors);

      if (inFrame) {
        return { root: frame, ...inFrame };
      }
    }
  }

  return null;
}

async function dragThumbWithPointerEvents(thumb: Locator, percent: number): Promise<void> {
  await thumb.evaluate(async (thumbEl, targetPercent) => {
    const track =
      thumbEl.closest('.Track')
      ?? thumbEl.closest('.CaptchaSlider')?.querySelector('.Track')
      ?? thumbEl.parentElement;

    if (!track) {
      return;
    }

    const trackRect = track.getBoundingClientRect();
    const thumbRect = thumbEl.getBoundingClientRect();
    const startX = thumbRect.left + thumbRect.width / 2;
    const startY = thumbRect.top + thumbRect.height / 2;
    const clamped = Math.min(0.98, Math.max(0.05, targetPercent as number));
    const endX = trackRect.left + trackRect.width * clamped;
    const endY = startY;

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const dispatch = (type: string, x: number, y: number, target: EventTarget, buttons = 1) => {
      const common = {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        view: window,
        buttons,
      };

      target.dispatchEvent(new PointerEvent(type, common));

      const mouseType = type.replace('pointer', 'mouse');

      if (mouseType === 'mousedown' || mouseType === 'mousemove' || mouseType === 'mouseup') {
        target.dispatchEvent(new MouseEvent(mouseType, common));
      }
    };

    if (thumbEl instanceof HTMLElement) {
      thumbEl.focus();
    }

    dispatch('pointerdown', startX, startY, thumbEl);
    dispatch('mousedown', startX, startY, thumbEl);

    const steps = 28;

    for (let step = 1; step <= steps; step += 1) {
      const x = startX + ((endX - startX) * step) / steps;
      const y = endY + (Math.random() * 2 - 1);
      dispatch('pointermove', x, y, document);
      dispatch('mousemove', x, y, document);
      await sleep(18 + Math.floor(Math.random() * 24));
    }

    dispatch('pointermove', endX, endY, document);
    dispatch('mousemove', endX, endY, document);
    dispatch('pointerup', endX, endY, document, 0);
    dispatch('mouseup', endX, endY, document, 0);
  }, percent);
}

async function dragThumbOnce(thumb: Locator, track: Locator, percent: number): Promise<number> {
  const trackBox = await track.boundingBox();
  const thumbBox = await thumb.boundingBox();

  if (trackBox && thumbBox) {
    const targetX = Math.max(8, Math.floor(trackBox.width * percent));
    const targetY = Math.max(4, Math.floor(trackBox.height / 2));

    try {
      await thumb.dragTo(track, {
        force: true,
        targetPosition: { x: targetX, y: targetY },
        timeout: 10000,
      });
    } catch {
      await dragThumbWithPointerEvents(thumb, percent);
    }
  } else {
    await dragThumbWithPointerEvents(thumb, percent);
  }

  await thumb.page().waitForTimeout(randomPause(500, 900));

  return getSliderProgress(thumb);
}

async function solveYandexSlider(
  page: Page,
  iframeSelectors: string[],
  thumbSelectors: string[],
  trackSelectors: string[],
): Promise<SliderSolveResult> {
  const slider = await findSliderElements(page, iframeSelectors, thumbSelectors, trackSelectors);

  if (!slider) {
    if (await isImageCaptchaVisible(page, iframeSelectors)) {
      return 'image';
    }

    logger.warn({ iframeSelectors, thumbSelectors }, 'Slider thumb not found');

    return 'not_found';
  }

  const { thumb, track } = slider;

  await thumb.scrollIntoViewIfNeeded().catch(() => undefined);
  await page.waitForTimeout(randomPause(400, 800));
  await humanIdleJitter(page);
  await page.waitForTimeout(randomPause(300, 700));

  logger.info({ initialProgress: await getSliderProgress(thumb) }, 'Slider found, single drag to right');

  const progress = await dragThumbOnce(thumb, track, 1);

  logger.info({ progress }, 'Slider drag completed');

  await page.waitForTimeout(randomPause(1200, 2000));

  if (await isImageCaptchaVisible(page, iframeSelectors)) {
    logger.info('Image captcha appeared after slider — stopping slider attempts');

    return 'image';
  }

  return 'dragged';
}

async function isReallyVisible(locator: Locator): Promise<boolean> {
  if ((await locator.count()) === 0) {
    return false;
  }

  return locator
    .evaluate((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return false;
      }

      return rect.width >= 8 && rect.height >= 8;
    })
    .catch(() => false);
}

async function isCaptchaWidgetPresent(
  page: Page,
  iframeSelectors: string[],
  _checkboxSelectors: string[],
  sliderSelectors: string[],
): Promise<boolean> {
  const captchaOnlySelectors = [
    ...iframeSelectors,
    ...sliderSelectors,
    'iframe[src*="smartcaptcha"]',
    'iframe[src*="captcha.yandex"]',
    'iframe[data-testid="checkbox-iframe"]',
    '.CheckboxCaptcha-Button',
    '.CheckboxCaptcha-Anchor',
    '.CheckboxCaptcha',
    '.smart-captcha',
    '[class*="SmartCaptcha"]',
    '.AdvancedCaptcha',
    '#captcha-slider',
    '[data-testid="thumb"]',
  ];

  for (const selector of captchaOnlySelectors) {
    if (await isReallyVisible(page.locator(selector).first())) {
      return true;
    }
  }

  return false;
}

/** Real Yandex captcha thumbs only — never Mantine/price `[role=slider]`. */
const YANDEX_SLIDER_THUMB_SELECTORS = [
  '#captcha-slider',
  '[data-testid="thumb"]',
  '.CaptchaSlider .Thumb',
  '.Thumb[role="slider"]',
  '.AdvancedCaptcha [role="slider"]',
];

const YANDEX_CHECKBOX_SELECTORS = [
  '#js-button',
  '.CheckboxCaptcha-Button',
  '.CheckboxCaptcha-Anchor',
  '[data-testid="checkbox-captcha"] [role="checkbox"]',
  'input.CheckboxCaptcha-Button[role="checkbox"]',
  '#checkbox-captcha-form [role="checkbox"]',
  'form#checkbox-captcha-form input[type="submit"]',
];

const YANDEX_CHECKBOX_IFRAME_SELECTORS = [
  'iframe[data-testid="checkbox-iframe"]',
  'iframe[src*="checkbox"]',
  'iframe[src*="smartcaptcha"]',
  'iframe[src*="captcha.yandex"]',
  'iframe[data-testid="advanced-iframe"]',
];

/**
 * SmartCaptcha often keeps the checkbox iframe after text/icons success.
 * Use frame.evaluate (no Playwright auto-wait) — frameLocator+getAttribute hangs 30s+.
 */
async function isYandexCheckboxPassed(
  page: Page,
  _iframeSelectors: string[] = [],
): Promise<boolean> {
  const checkFn = (): boolean => {
    const btn = document.querySelector(
      '#js-button, .CheckboxCaptcha-Button[role="checkbox"], [data-testid="checkbox-captcha"] [role="checkbox"], [role="checkbox"].CheckboxCaptcha-Button',
    );
    if (btn?.getAttribute('aria-checked') === 'true') {
      return true;
    }

    if (
      document.querySelector(
        '.CheckboxCaptcha-Checkbox[data-checked="true"], .CheckboxCaptcha_checked, [data-testid="checkbox-captcha"][data-checked="true"]',
      )
    ) {
      return true;
    }

    const live = document.querySelector('[aria-live="assertive"]');
    const liveText = (live?.textContent || '').trim();
    if (/пользователь проверен|user verified/i.test(liveText)) {
      return true;
    }

    return false;
  };

  try {
    if (await page.mainFrame().evaluate(checkFn)) {
      return true;
    }
  } catch {
    // ignore
  }

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) {
      continue;
    }

    const frameUrl = frame.url();
    if (!/smartcaptcha|captcha\.yandex|checkbox\.ru|\/checkbox/i.test(frameUrl)) {
      continue;
    }

    try {
      if (await frame.evaluate(checkFn)) {
        return true;
      }
    } catch {
      // cross-origin / detached
    }
  }

  return false;
}

const YANDEX_ICONS_SELECTORS = {
  advancedIframe: 'iframe[data-testid="advanced-iframe"], iframe[src*="smartcaptcha"], iframe[src*="captcha.yandex"]',
  mainImage: '.AdvancedCaptcha-ImageWrapper img, .AdvancedCaptcha-View img, .AdvancedCaptcha-Image img',
  instruction: '.AdvancedCaptcha-SilhouetteTask, .AdvancedCaptcha-SilhouetteTask img, .AdvancedCaptcha-CanvasContainer canvas, [class*="SilhouetteTask"]',
  submit: 'button[data-testid="submit"], .AdvancedCaptcha button[type="submit"], .CaptchaButton[type="submit"]',
};

/** Visible interactive challenge the user must complete (slider / image / icons / checkbox button). */
async function isInteractiveChallengeVisible(
  page: Page,
  iframeSelectors: string[],
  _sliderSelectors: string[],
): Promise<'slider' | 'image' | 'icons' | 'checkbox' | null> {
  if (await isIconsCaptchaVisible(page, iframeSelectors)) {
    return 'icons';
  }

  if (await isImageCaptchaVisible(page, iframeSelectors)) {
    return 'image';
  }

  // 1) Real captcha slider on page (AdvancedCaptcha host) or inside captcha iframes.
  for (const selector of YANDEX_SLIDER_THUMB_SELECTORS) {
    if (await isReallyVisible(page.locator(selector).first())) {
      return 'slider';
    }
  }

  // Page-level checkbox (showcaptcha) — not inside iframe.
  for (const checkboxSelector of YANDEX_CHECKBOX_SELECTORS) {
    if (await isReallyVisible(page.locator(checkboxSelector).first())) {
      return 'checkbox';
    }
  }

  if (/showcaptcha/i.test(page.url()) && (await page.locator('.CheckboxCaptcha, #checkbox-captcha-form').count()) > 0) {
    return 'checkbox';
  }

  // Visible reCAPTCHA / hCaptcha widgets (fullscreen or near form).
  for (const selector of [
    'iframe[src*="recaptcha"]',
    'iframe[title*="reCAPTCHA"]',
    '.g-recaptcha',
    'iframe[src*="hcaptcha"]',
    '.h-captcha',
  ]) {
    if (await isReallyVisible(page.locator(selector).first())) {
      return 'checkbox';
    }
  }

  const framesToTry = [
    ...iframeSelectors,
    'iframe[data-testid="checkbox-iframe"]',
    'iframe[data-testid="advanced-iframe"]',
    'iframe[src*="smartcaptcha"]',
    'iframe[src*="captcha.yandex"]',
  ];

  for (const iframeSelector of [...new Set(framesToTry)]) {
    const iframe = page.locator(iframeSelector).first();

    if ((await iframe.count()) === 0) {
      continue;
    }

    // Checkbox iframe can be small but must be visible.
    if (!(await isReallyVisible(iframe)) && !(await iframe.isVisible().catch(() => false))) {
      continue;
    }

    const frame = page.frameLocator(iframeSelector).first();

    for (const selector of YANDEX_SLIDER_THUMB_SELECTORS) {
      if (await isReallyVisible(frame.locator(selector).first())) {
        return 'slider';
      }
    }

    for (const checkboxSelector of YANDEX_CHECKBOX_SELECTORS) {
      const box = frame.locator(checkboxSelector).first();

      if ((await box.count()) > 0) {
        return 'checkbox';
      }
    }
  }

  return null;
}

async function waitForInteractiveChallenge(
  page: Page,
  iframeSelectors: string[],
  sliderSelectors: string[],
  timeoutMs: number,
): Promise<'slider' | 'image' | 'icons' | 'checkbox' | null> {
  const deadline = Date.now() + Math.max(0, timeoutMs);

  while (Date.now() <= deadline) {
    const kind = await isInteractiveChallengeVisible(page, iframeSelectors, sliderSelectors);

    if (kind) {
      return kind;
    }

    await page.waitForTimeout(200);
  }

  return isInteractiveChallengeVisible(page, iframeSelectors, sliderSelectors);
}

export async function resolveCaptcha(
  page: Page,
  formRoot: Locator,
  config: CaptchaConfig,
  options: ResolveCaptchaOptions = {},
): Promise<boolean> {
  let effectiveConfig = config;
  let captchaType = normalizeCaptchaType(config.captcha_type);
  const appearTimeoutMs = options.appearTimeoutMs ?? 2000;
  const allowBlindTokenSolve = options.allowBlindTokenSolve === true;
  const phase = options.phase ?? 'pre-submit';

  // Mapping may say "none", but dealer sites often inject captcha after phone fill / submit.
  if (captchaType === 'none') {
    const live = await detectLiveCaptchaConfig(page);

    if (!live) {
      return false;
    }

    effectiveConfig = mergeCaptchaConfig(config, live);
    captchaType = normalizeCaptchaType(effectiveConfig.captcha_type);
    logger.info({ captchaType, phase }, 'Auto-detected live captcha (mapping had none)');
  }

  if (captchaType === 'none') {
    return false;
  }

  const defaults = CAPTCHA_DEFAULTS[captchaType];
  const iframeSelectors = effectiveConfig.captcha_iframe_selector
    ? [effectiveConfig.captcha_iframe_selector]
    : defaults.iframeSelectors;
  const tokenSelectors = effectiveConfig.captcha_token_selector
    ? [effectiveConfig.captcha_token_selector]
    : defaults.tokenSelectors;

  // Already solved — do not re-enter checkbox/slider/icons (each drain used to cost 15–60s).
  if (await hasCaptchaToken(page, formRoot, tokenSelectors)) {
    const hardChallenge = await isInteractiveChallengeVisible(
      page,
      iframeSelectors,
      defaults.sliderThumbSelectors,
    );
    if (!hardChallenge || hardChallenge === 'checkbox') {
      logger.info({ captchaType, phase }, 'Captcha token already present — skip resolve');
      return true;
    }
  }

  // Text captcha finished: only the verified "Я не робот" shell remains (often inside iframe).
  if (
    !(await isImageCaptchaVisible(page, iframeSelectors))
    && !(await isIconsCaptchaVisible(page, iframeSelectors))
    && await isYandexCheckboxPassed(page, iframeSelectors)
  ) {
    logger.info({ captchaType, phase }, 'Checkbox already passed (iframe/page) — skip resolve');
    return true;
  }

  const mappedMode = normalizeYandexMode(effectiveConfig.captcha_yandex_mode);

  const challenge = await waitForInteractiveChallenge(
    page,
    iframeSelectors,
    defaults.sliderThumbSelectors,
    appearTimeoutMs,
  );

  if (!challenge) {
    // Token without interactive UI: only trust on post-submit if already solved.
    if (phase === 'post-submit' && await waitForToken(page, formRoot, tokenSelectors, 400)) {
      logger.info({ captchaType, phase }, 'Captcha token present after submit, no UI');

      return true;
    }

    logger.info(
      { captchaType, appearTimeoutMs, phase },
      'No interactive captcha — skipping',
    );

    return false;
  }

  logger.info({ captchaType, challenge, phase }, 'Interactive captcha detected');

  // Direct icons challenge (after soft redirect or page reload).
  if (challenge === 'icons') {
    const iconsSolved = await solveYandexIconsCaptcha(page, formRoot, iframeSelectors, tokenSelectors);

    if (iconsSolved || await waitForToken(page, formRoot, tokenSelectors, 3000)) {
      logger.info({ captchaType }, 'Captcha resolved via icons challenge');

      return true;
    }

    throw new Error('Капча Yandex SmartCaptcha: задание с иконками не удалось решить.');
  }

  // rent2buy-like: checkbox iframe first → then optional slider/image/icons.
  if (challenge === 'checkbox') {
    const checkboxSelectors = [
      ...YANDEX_CHECKBOX_SELECTORS,
      ...(effectiveConfig.captcha_checkbox_selector ? [effectiveConfig.captcha_checkbox_selector] : []),
      ...defaults.checkboxSelectors,
    ];

    // Verified checkbox after text captcha — proceed to form submit immediately.
    if (await isYandexCheckboxPassed(page, iframeSelectors)) {
      logger.info({ captchaType, phase }, 'Checkbox already verified — treat as solved');
      return true;
    }

    logger.info({ captchaType, iframeSelectors, checkboxSelectors }, 'Resolving checkbox captcha');

    const clicked = await clickCaptchaCheckbox(page, iframeSelectors, checkboxSelectors);

    if (!clicked) {
      logger.warn({ captchaType, phase }, 'Captcha checkbox not clickable');

      return false;
    }

    // Token may appear right after checkbox — don't burn 10–12s waiting for icons.
    if (await waitForToken(page, formRoot, tokenSelectors, 800)) {
      logger.info({ captchaType }, 'Captcha token ready right after checkbox');
      return true;
    }

    if (await isYandexCheckboxPassed(page, iframeSelectors)) {
      logger.info({ captchaType }, 'Checkbox verified after click (no token yet) — treat as solved');
      return true;
    }

    // Short poll for icons/slider/image (max ~4s), not a blind 12s wait.
    const next = await waitForInteractiveChallenge(
      page,
      iframeSelectors,
      defaults.sliderThumbSelectors,
      4000,
    );

    if (next === 'icons' || await isIconsCaptchaVisible(page, iframeSelectors)) {
      const iconsSolved = await solveYandexIconsCaptcha(page, formRoot, iframeSelectors, tokenSelectors);

      if (iconsSolved || await waitForToken(page, formRoot, tokenSelectors, 3000)) {
        logger.info({ captchaType }, 'Captcha resolved via icons after checkbox');

        return true;
      }

      throw new Error('Капча Yandex SmartCaptcha: после галочки показаны иконки, но решить не удалось.');
    }

    if (next === 'slider') {
      const sliderResult = await solveYandexSlider(
        page,
        iframeSelectors,
        defaults.sliderThumbSelectors,
        defaults.sliderTrackSelectors,
      );

      if (sliderResult === 'image' || await isImageCaptchaVisible(page, iframeSelectors)) {
        const imageSolved = await solveYandexImageCaptcha(page, formRoot, iframeSelectors, tokenSelectors);

        if (imageSolved || await waitForToken(page, formRoot, tokenSelectors, 3000)) {
          logger.info({ captchaType }, 'Captcha resolved via image after checkbox+slider');

          return true;
        }

        throw new Error('Капча Yandex SmartCaptcha: показано «текст с картинки», но решить не удалось.');
      }

      if (await isIconsCaptchaVisible(page, iframeSelectors)) {
        const iconsSolved = await solveYandexIconsCaptcha(page, formRoot, iframeSelectors, tokenSelectors);

        if (iconsSolved) {
          logger.info({ captchaType }, 'Captcha resolved via icons after checkbox+slider');

          return true;
        }
      }

      if (await waitForToken(page, formRoot, tokenSelectors, 8000)) {
        logger.info({ captchaType }, 'Captcha resolved after checkbox+slider');

        return true;
      }
    }

    if (next === 'image' || await isImageCaptchaVisible(page, iframeSelectors)) {
      const imageSolved = await solveYandexImageCaptcha(page, formRoot, iframeSelectors, tokenSelectors);

      if (imageSolved || await waitForToken(page, formRoot, tokenSelectors, 3000)) {
        logger.info({ captchaType }, 'Captcha resolved via image after checkbox');

        return true;
      }
    }

    // Soft pass: redirected off showcaptcha after checkbox alone.
    if (/showcaptcha/i.test(page.url()) === false && /\/search\//i.test(page.url())) {
      logger.info({ captchaType }, 'Captcha resolved after checkbox (redirect to search)');

      return true;
    }

    if (await waitForToken(page, formRoot, tokenSelectors, 3000)) {
      logger.info({ captchaType }, 'Captcha resolved after checkbox');

      return true;
    }

    // Text challenge already done: widget shows checkmark but often no smart-token in DOM.
    if (await isYandexCheckboxPassed(page, iframeSelectors)) {
      logger.info({ captchaType }, 'Checkbox verified without smart-token — treat as solved');
      return true;
    }

    // reCAPTCHA / hCaptcha: checkbox click often enough — challenge may open in another iframe.
    if (captchaType === 'google_recaptcha_v2' || captchaType === 'hcaptcha') {
      await page.waitForTimeout(randomPause(1500, 2500));

      if (await waitForToken(page, formRoot, tokenSelectors, 8000)) {
        return true;
      }

      // Soft success if checkbox iframe marked checked.
      const checked = await page.evaluate(() => {
        const frames = [...document.querySelectorAll('iframe[src*="recaptcha"], iframe[src*="hcaptcha"]')];
        return frames.some((frame) => {
          const rect = frame.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      }).catch(() => false);

      if (checked) {
        logger.info({ captchaType }, 'Checkbox captcha clicked (token may be set by widget)');

        return true;
      }
    }

    logger.warn({ captchaType, url: page.url() }, 'Checkbox clicked but token/redirect not ready');

    return false;
  }

  if (challenge === 'slider' || challenge === 'image') {
    logger.info({ captchaType, challenge, iframeSelectors }, 'Resolving Yandex slider/image captcha');

    if (challenge === 'image' || await isImageCaptchaVisible(page, iframeSelectors)) {
      const imageSolved = await solveYandexImageCaptcha(page, formRoot, iframeSelectors, tokenSelectors);

      if (imageSolved || await waitForToken(page, formRoot, tokenSelectors, 3000)) {
        logger.info({ captchaType }, 'Captcha resolved via image challenge');

        return true;
      }

      throw new Error('Капча Yandex SmartCaptcha: показано «текст с картинки», но решить не удалось.');
    }

    const sliderResult = await solveYandexSlider(
      page,
      iframeSelectors,
      defaults.sliderThumbSelectors,
      defaults.sliderTrackSelectors,
    );

    if (sliderResult === 'image' || await isImageCaptchaVisible(page, iframeSelectors)) {
      const imageSolved = await solveYandexImageCaptcha(page, formRoot, iframeSelectors, tokenSelectors);

      if (imageSolved || await waitForToken(page, formRoot, tokenSelectors, 3000)) {
        logger.info({ captchaType }, 'Captcha resolved via image challenge');

        return true;
      }

      throw new Error('Капча Yandex SmartCaptcha: показано «текст с картинки», но решить не удалось.');
    }

    if (await isIconsCaptchaVisible(page, iframeSelectors)) {
      const iconsSolved = await solveYandexIconsCaptcha(page, formRoot, iframeSelectors, tokenSelectors);

      if (iconsSolved) {
        logger.info({ captchaType }, 'Captcha resolved via icons after slider');

        return true;
      }
    }

    if (sliderResult === 'not_found') {
      logger.warn({ captchaType, phase }, 'Captcha slider thumb not found — skipping');

      return false;
    }

    if (await waitForToken(page, formRoot, tokenSelectors, 8000)) {
      logger.info({ captchaType }, 'Captcha resolved after slider');

      return true;
    }

    throw new Error(
      'Капча Yandex SmartCaptcha (слайдер): ползунок сдвинут, но токен не появился и окно с картинкой не найдено.',
    );
  }

  return false;
}

function mergeCaptchaConfig(base: CaptchaConfig, live: CaptchaConfig): CaptchaConfig {
  return {
    captcha_type: live.captcha_type ?? base.captcha_type,
    captcha_yandex_mode: live.captcha_yandex_mode ?? base.captcha_yandex_mode,
    captcha_iframe_selector: live.captcha_iframe_selector ?? base.captcha_iframe_selector,
    captcha_checkbox_selector: live.captcha_checkbox_selector ?? base.captcha_checkbox_selector,
    captcha_token_selector: live.captcha_token_selector ?? base.captcha_token_selector,
  };
}

/**
 * Detect currently visible captcha widget anywhere on the page
 * (fullscreen overlay, modal, or inline next to the form).
 */
export async function detectLiveCaptchaConfig(page: Page): Promise<CaptchaConfig | null> {
  // SmartCaptcha iframes often load with opacity:0 — still interactive. Prefer frame URL.
  const yandexFrame = page.frames().some((frame) => {
    const url = frame.url();
    return /smartcaptcha\.yandex|captcha\.yandexcloud|captcha\.yandex\.ru/i.test(url);
  });

  if (yandexFrame) {
    let slider = false;
    for (const frame of page.frames()) {
      if (!/smartcaptcha|captcha\.yandex/i.test(frame.url())) {
        continue;
      }
      slider = await frame.evaluate(() => {
        return !!(
          document.querySelector('#captcha-slider, [data-testid="thumb"], .AdvancedCaptcha_image, input[name="rep"]')
        );
      }).catch(() => false);
      if (slider) {
        break;
      }
    }

    return {
      captcha_type: 'yandex_smartcaptcha',
      captcha_yandex_mode: slider ? 'slider' : 'checkbox',
      captcha_iframe_selector:
        'iframe[data-testid="advanced-iframe"], iframe[data-testid="checkbox-iframe"], iframe[src*="smartcaptcha"], iframe[src*="captcha.yandex"], iframe[src*="checkbox"]',
      captcha_checkbox_selector: slider
        ? '#captcha-slider, [data-testid="thumb"]'
        : '#js-button, .CheckboxCaptcha-Button, [role="checkbox"]',
      captcha_token_selector: 'input[name="smart-token"]',
    };
  }

  const kind = await page.evaluate(() => {
    const isVisible = (el: Element | null): boolean => {
      if (!el || !(el instanceof HTMLElement)) {
        return false;
      }

      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }

      const src = el.tagName === 'IFRAME' ? (el.getAttribute('src') || '') : '';
      const isCaptchaFrame = /smartcaptcha|captcha\.yandex|recaptcha|hcaptcha/i.test(src);
      if (!isCaptchaFrame && Number(style.opacity) === 0) {
        return false;
      }

      return rect.width >= 20 && rect.height >= 20;
    };

    const anyVisible = (selectors: string[]): boolean =>
      selectors.some((selector) => {
        for (const node of document.querySelectorAll(selector)) {
          if (isVisible(node)) {
            return true;
          }
        }

        return false;
      });

    const yandex = anyVisible([
      '#checkbox-captcha-form',
      '.CheckboxCaptcha',
      '.CheckboxCaptcha-Button',
      '[data-testid="checkbox-captcha"]',
      'iframe[data-testid="checkbox-iframe"]',
      'iframe[data-testid="advanced-iframe"]',
      'iframe[src*="smartcaptcha"]',
      'iframe[src*="captcha.yandex"]',
      '.AdvancedCaptcha',
      '.AdvancedCaptcha-SilhouetteTask',
      '.smart-captcha',
      '[class*="SmartCaptcha"]',
      '#captcha-slider',
      '[data-testid="thumb"]',
    ]);

    if (yandex) {
      const slider = anyVisible(['#captcha-slider', '[data-testid="thumb"]', '.CaptchaSlider .Thumb', '.AdvancedCaptcha']);

      return { type: 'yandex_smartcaptcha' as const, slider };
    }

    if (anyVisible([
      'iframe[src*="recaptcha"]',
      '.g-recaptcha',
      '#recaptcha-anchor',
      'iframe[title*="reCAPTCHA"]',
    ])) {
      return { type: 'google_recaptcha_v2' as const, slider: false };
    }

    if (anyVisible([
      'iframe[src*="hcaptcha"]',
      '.h-captcha',
      'iframe[src*="newassets.hcaptcha"]',
    ])) {
      return { type: 'hcaptcha' as const, slider: false };
    }

    return null;
  }).catch(() => null);

  if (!kind) {
    return null;
  }

  if (kind.type === 'yandex_smartcaptcha') {
    return {
      captcha_type: 'yandex_smartcaptcha',
      captcha_yandex_mode: kind.slider ? 'slider' : 'checkbox',
      captcha_iframe_selector:
        'iframe[data-testid="advanced-iframe"], iframe[data-testid="checkbox-iframe"], iframe[src*="smartcaptcha"], iframe[src*="captcha.yandex"], iframe[src*="checkbox"]',
      captcha_checkbox_selector: kind.slider
        ? '#captcha-slider, [data-testid="thumb"]'
        : '#js-button, .CheckboxCaptcha-Button, [role="checkbox"]',
      captcha_token_selector: 'input[name="smart-token"]',
    };
  }

  if (kind.type === 'google_recaptcha_v2') {
    return {
      captcha_type: 'google_recaptcha_v2',
      captcha_yandex_mode: null,
      captcha_iframe_selector: 'iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"]',
      captcha_checkbox_selector: '#recaptcha-anchor, .recaptcha-checkbox-border, [role="checkbox"]',
      captcha_token_selector: 'textarea[name="g-recaptcha-response"], #g-recaptcha-response',
    };
  }

  return {
    captcha_type: 'hcaptcha',
    captcha_yandex_mode: null,
    captcha_iframe_selector: 'iframe[src*="hcaptcha"]',
    captcha_checkbox_selector: '#checkbox, [role="checkbox"]',
    captcha_token_selector: 'textarea[name="h-captcha-response"], input[name="h-captcha-response"]',
  };
}

export type FormCaptchaWatcher = {
  /**
   * Wait for in-flight solve, then scan+solve.
   * @param waitForAppearMs how long to poll for a late-appearing widget (phone fill → SmartCaptcha).
   */
  drain: (waitForAppearMs?: number) => Promise<boolean>;
  stop: () => void;
  wasSolved: () => boolean;
};

/**
 * Continuous listener during form fill/submit.
 * Watches for captcha widgets (fullscreen overlay OR near the form) and solves them
 * (checkbox click for SmartCaptcha / reCAPTCHA / hCaptcha, then slider/icons if needed).
 */
export function attachFormCaptchaWatcher(
  page: Page,
  formRoot: Locator,
  baseConfig: CaptchaConfig,
): FormCaptchaWatcher {
  let stopped = false;
  let solving = false;
  let activeSolve: Promise<void> | null = null;
  let solvedCount = 0;
  let lastSolvedAt = 0;

  const defaultTokenSelectors = (): string[] => {
    const type = normalizeCaptchaType(baseConfig.captcha_type);
    if (type === 'none') {
      return [
        'input[name="smart-token"]',
        'textarea[name="g-recaptcha-response"]',
        'textarea[name="h-captcha-response"]',
        '#g-recaptcha-response',
      ];
    }
    const defaults = CAPTCHA_DEFAULTS[type];
    return baseConfig.captcha_token_selector
      ? [baseConfig.captcha_token_selector, ...defaults.tokenSelectors]
      : defaults.tokenSelectors;
  };

  const alreadyReady = async (): Promise<boolean> => {
    const iframeSelectors = CAPTCHA_DEFAULTS.yandex_smartcaptcha.iframeSelectors;

    // Token / verified checkbox beat stale AdvancedCaptcha DOM still in the iframe.
    // Without this, drain/poll re-send the same image to RuCaptcha for minutes.
    if (await hasCaptchaToken(page, formRoot, defaultTokenSelectors())) {
      return true;
    }

    if (await isYandexCheckboxPassed(page, iframeSelectors)) {
      return true;
    }

    const hard = await isInteractiveChallengeVisible(
      page,
      iframeSelectors,
      CAPTCHA_DEFAULTS.yandex_smartcaptcha.sliderThumbSelectors,
    ).catch(() => null);

    // After a successful slider/image solve the AdvancedCaptcha shell often lingers —
    // do NOT re-enter RuCaptcha for minutes. Only icons is treated as a fresh challenge.
    if (solvedCount > 0 && hard !== 'icons') {
      return true;
    }

    if (hard === 'image' || hard === 'icons' || hard === 'slider' || hard === 'checkbox') {
      return false;
    }

    return false;
  };

  const runSolve = (reason: string): void => {
    if (stopped || solving) {
      return;
    }

    solving = true;
    activeSolve = (async () => {
      try {
        if (await alreadyReady()) {
          logger.info({ reason }, 'Form captcha watcher: token ready — skip');
          return;
        }

        const live = await detectLiveCaptchaConfig(page);

        if (!live && normalizeCaptchaType(baseConfig.captcha_type) === 'none') {
          return;
        }

        const config = live ? mergeCaptchaConfig(baseConfig, live) : baseConfig;

        if (normalizeCaptchaType(config.captcha_type) === 'none') {
          return;
        }

        logger.info(
          { reason, captchaType: config.captcha_type, url: page.url() },
          'Form captcha watcher: widget visible — solving',
        );

        const ok = await resolveCaptcha(page, formRoot, config, {
          appearTimeoutMs: 1500,
          phase: 'post-submit',
          allowBlindTokenSolve: false,
        });

        if (ok) {
          solvedCount += 1;
          lastSolvedAt = Date.now();
          logger.info({ reason, solvedCount }, 'Form captcha watcher: solved');
        }
      } catch (error) {
        logger.warn({ err: error, reason }, 'Form captcha watcher: solve failed');
      } finally {
        solving = false;
      }
    })();
  };

  const pollId = setInterval(() => {
    if (stopped || solving) {
      return;
    }

    void (async () => {
      if (await alreadyReady()) {
        return;
      }
      // Do not restart RuCaptcha loops on a lingering slider/image shell.
      if (solvedCount > 0) {
        return;
      }
      const live = await detectLiveCaptchaConfig(page).catch(() => null);
      if (live) {
        runSolve('poll');
      }
    })();
  }, 900);

  return {
    async drain(waitForAppearMs = 0): Promise<boolean> {
      // Mapped captcha=none and no live widget → do not burn 3–15s idle loops before submit.
      if (normalizeCaptchaType(baseConfig.captcha_type) === 'none') {
        const liveQuick = await detectLiveCaptchaConfig(page).catch(() => null);
        if (!liveQuick) {
          return false;
        }
      }

      const deadline = Date.now() + Math.max(0, waitForAppearMs);

      do {
        if (activeSolve) {
          await activeSolve.catch(() => undefined);
        }

        if ((await alreadyReady()) || solvedCount > 0) {
          return true;
        }

        const live = await detectLiveCaptchaConfig(page);

        if (live || normalizeCaptchaType(baseConfig.captcha_type) !== 'none') {
          runSolve('drain');
          if (activeSolve) {
            await activeSolve.catch(() => undefined);
          }

          if ((await alreadyReady()) || solvedCount > 0) {
            return true;
          }
        }

        if (Date.now() >= deadline) {
          break;
        }

        await page.waitForTimeout(350);
      } while (Date.now() < deadline);

      return solvedCount > 0 || await alreadyReady();
    },
    stop(): void {
      stopped = true;
      clearInterval(pollId);
    },
    wasSolved(): boolean {
      return solvedCount > 0;
    },
  };
}
