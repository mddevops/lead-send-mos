import pino from 'pino';
import { Browser, BrowserContext, chromium } from 'playwright';
import { Camoufox } from 'camoufox-js';
import { config } from '../config';
import { BrowserFingerprint, pickBrowserFingerprint, RegionPayload } from '../utils/browserProfiles';
import { BrowserProxy } from './browserTypes';

export type { BrowserProxy } from './browserTypes';

export type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  engine: 'chromium' | 'camoufox';
  fingerprint: BrowserFingerprint;
};

export type OpenBrowserOptions = {
  headless?: boolean;
  /** Desktop layout (1920x1080) — avoids mobile breakpoints that hide forms. Prefer fingerprint for submit. */
  desktopFullScreen?: boolean;
  region?: RegionPayload;
  /** If set, use this fingerprint; otherwise pick random PC profile + region geo. */
  fingerprint?: BrowserFingerprint;
  /** Playwright storageState JSON path (cookies + localStorage), e.g. Yandex after captcha. */
  storageState?: string;
};

const logger = pino({ name: 'browser' });

const STEALTH_LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--no-first-run',
  '--no-default-browser-check',
];

function resolveViewport(
  desktopFullScreen: boolean,
  fingerprint?: BrowserFingerprint,
): { width: number; height: number } {
  if (fingerprint?.viewport) {
    return fingerprint.viewport;
  }

  const width = desktopFullScreen ? 1920 : config.BOT_VIEWPORT_WIDTH;
  const height = desktopFullScreen ? 1080 : config.BOT_VIEWPORT_HEIGHT;

  return {
    width: Math.max(800, Math.min(2560, Number.isFinite(width) ? width : 1920)),
    height: Math.max(600, Math.min(1440, Number.isFinite(height) ? height : 1080)),
  };
}

/**
 * Patch browser.newContext so viewport:null + deviceScaleFactor never reach Playwright.
 */
function patchNewContext(browser: Browser, fallbackViewport: { width: number; height: number }): void {
  const original = browser.newContext.bind(browser);

  browser.newContext = (async (options = {}) => {
    const merged: Record<string, unknown> = { ...(options as Record<string, unknown>) };

    if (merged.viewport == null) {
      merged.viewport = {
        width: fallbackViewport.width,
        height: fallbackViewport.height,
      };
    }

    delete merged.deviceScaleFactor;
    delete merged.isMobile;
    delete merged.hasTouch;
    delete merged.noDefaultViewport;

    try {
      return await original(merged as Parameters<Browser['newContext']>[0]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('deviceScaleFactor') && !message.includes('viewport')) {
        throw error;
      }

      logger.warn({ message }, 'newContext conflict, forcing plain desktop viewport');

      return original({
        viewport: {
          width: fallbackViewport.width,
          height: fallbackViewport.height,
        },
      });
    }
  }) as Browser['newContext'];
}

async function applyFingerprintInitScript(
  context: BrowserContext,
  fingerprint: BrowserFingerprint,
): Promise<void> {
  const platform = fingerprint.platform;
  const languages = fingerprint.acceptLanguage
    .split(',')
    .map((part) => part.split(';')[0]?.trim())
    .filter((v): v is string => Boolean(v));

  await context.addInitScript(
    ({ platformValue, langs }) => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });

      Object.defineProperty(navigator, 'languages', {
        get: () => langs,
      });

      Object.defineProperty(navigator, 'platform', {
        get: () => platformValue,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).chrome = (window as any).chrome ?? { runtime: {} };

      const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);

      window.navigator.permissions.query = (parameters: PermissionDescriptor) => (
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
          : originalQuery(parameters)
      );

      window.__botMouseX = window.innerWidth / 2;
      window.__botMouseY = window.innerHeight / 2;
    },
    { platformValue: platform, langs: languages.length > 0 ? languages : ['ru-RU', 'ru'] },
  );

  await context.grantPermissions(['geolocation']).catch(() => undefined);
  await context.setGeolocation(fingerprint.geolocation).catch(() => undefined);
}

async function openCamoufoxBrowser(
  proxy?: BrowserProxy,
  options?: OpenBrowserOptions,
): Promise<BrowserSession> {
  const headless = options?.headless ?? config.BOT_HEADLESS;
  const fingerprint = options?.fingerprint ?? pickBrowserFingerprint(options?.region);
  const desktopFullScreen = options?.desktopFullScreen ?? false;
  const viewport = resolveViewport(desktopFullScreen, fingerprint);

  logger.info(
    {
      headless,
      desktopFullScreen,
      viewport,
      engine: 'camoufox',
      profileId: fingerprint.profileId,
      timezoneId: fingerprint.timezoneId,
      regionGeo: fingerprint.geolocation,
    },
    'Launching Camoufox (anti-detect Firefox)',
  );

  const proxyConfig = proxy
    ? {
        server: proxy.server,
        username: proxy.username,
        password: proxy.password,
      }
    : undefined;

  const camoufoxBaseOptions = {
    headless,
    humanize: true,
    os: 'windows' as const,
    locale: fingerprint.locale,
    window: [viewport.width, viewport.height] as [number, number],
    disable_coop: true,
    i_know_what_im_doing: true,
    proxy: proxyConfig,
  };

  let browser: Browser;

  try {
    if (proxyConfig) {
      try {
        browser = await Camoufox({
          ...camoufoxBaseOptions,
          geoip: true,
        }) as Browser;
      } catch (geoipError) {
        const geoipMessage = geoipError instanceof Error ? geoipError.message : String(geoipError);
        logger.warn({ geoipMessage }, 'Camoufox geoip failed, launching without geoip');
        browser = await Camoufox(camoufoxBaseOptions) as Browser;
      }
    } else {
      browser = await Camoufox(camoufoxBaseOptions) as Browser;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Не удалось запустить Camoufox: ${message}. `
      + 'Выполните: npx camoufox-js fetch. Или временно поставьте BOT_BROWSER=chromium в bot-worker/.env',
    );
  }

  patchNewContext(browser, viewport);

  const context = await browser.newContext({
    viewport,
    locale: fingerprint.locale,
    timezoneId: fingerprint.timezoneId,
    colorScheme: fingerprint.colorScheme,
    geolocation: fingerprint.geolocation,
    storageState: options?.storageState,
    extraHTTPHeaders: {
      'Accept-Language': fingerprint.acceptLanguage,
    },
  });

  await applyFingerprintInitScript(context, fingerprint);

  return { browser, context, engine: 'camoufox', fingerprint };
}

async function openChromiumBrowser(
  proxy?: BrowserProxy,
  options?: OpenBrowserOptions,
): Promise<BrowserSession> {
  const headless = options?.headless ?? config.BOT_HEADLESS;
  const fingerprint = options?.fingerprint ?? pickBrowserFingerprint(options?.region);
  const desktopFullScreen = options?.desktopFullScreen ?? false;
  const slowMo = headless ? 0 : Math.max(0, config.BOT_SLOW_MO);
  const viewport = resolveViewport(desktopFullScreen, fingerprint);
  const useInstalledChrome = config.BOT_USE_INSTALLED_CHROME;

  logger.info(
    {
      headless,
      desktopFullScreen,
      viewport,
      useInstalledChrome,
      engine: 'chromium',
      profileId: fingerprint.profileId,
      label: fingerprint.label,
      timezoneId: fingerprint.timezoneId,
      acceptLanguage: fingerprint.acceptLanguage,
      regionGeo: fingerprint.geolocation,
    },
    'Launching Chromium',
  );

  const browser = await chromium.launch({
    headless,
    channel: useInstalledChrome ? 'chrome' : undefined,
    slowMo: slowMo > 0 ? slowMo : undefined,
    args: [
      ...STEALTH_LAUNCH_ARGS,
      ...(!headless ? ['--start-maximized'] : []),
    ],
    proxy: proxy
      ? {
          server: proxy.server,
          username: proxy.username,
          password: proxy.password,
        }
      : undefined,
  });

  patchNewContext(browser, viewport);

  const context = await browser.newContext({
    locale: fingerprint.locale,
    timezoneId: fingerprint.timezoneId,
    userAgent: fingerprint.userAgent,
    viewport,
    colorScheme: fingerprint.colorScheme,
    geolocation: fingerprint.geolocation,
    storageState: options?.storageState,
    extraHTTPHeaders: {
      'Accept-Language': fingerprint.acceptLanguage,
    },
  });

  await applyFingerprintInitScript(context, fingerprint);

  return { browser, context, engine: 'chromium', fingerprint };
}

export async function openBrowser(proxy?: BrowserProxy, options?: OpenBrowserOptions): Promise<BrowserSession> {
  if (config.BOT_BROWSER === 'camoufox') {
    return openCamoufoxBrowser(proxy, options);
  }

  return openChromiumBrowser(proxy, options);
}

export async function closeBrowser(session: BrowserSession): Promise<void> {
  await session.context.close().catch(() => undefined);
  await session.browser.close().catch(() => undefined);
}
