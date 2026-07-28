import { config as baseConfig } from './config';

export type RuntimeOverlay = {
  BOT_CONCURRENCY?: number;
  CAPTCHA_SOLVER_ENABLED?: boolean;
  CAPTCHA_SOLVER_API_KEY?: string;
  CAPTCHA_SOLVER_PROVIDER?: '2captcha' | 'rucaptcha';
};

const overlay: RuntimeOverlay = {};

export function applyRuntimeOverlay(partial: RuntimeOverlay): void {
  if (typeof partial.BOT_CONCURRENCY === 'number' && Number.isFinite(partial.BOT_CONCURRENCY)) {
    overlay.BOT_CONCURRENCY = Math.max(1, Math.min(8, Math.floor(partial.BOT_CONCURRENCY)));
  }
  if (typeof partial.CAPTCHA_SOLVER_ENABLED === 'boolean') {
    overlay.CAPTCHA_SOLVER_ENABLED = partial.CAPTCHA_SOLVER_ENABLED;
  }
  if (typeof partial.CAPTCHA_SOLVER_API_KEY === 'string') {
    overlay.CAPTCHA_SOLVER_API_KEY = partial.CAPTCHA_SOLVER_API_KEY;
  }
  if (partial.CAPTCHA_SOLVER_PROVIDER === '2captcha' || partial.CAPTCHA_SOLVER_PROVIDER === 'rucaptcha') {
    overlay.CAPTCHA_SOLVER_PROVIDER = partial.CAPTCHA_SOLVER_PROVIDER;
  }
}

/** Effective runtime config: Laravel overlay wins over local .env. */
export const runtimeConfig = {
  get BOT_API_BASE_URL() {
    return baseConfig.BOT_API_BASE_URL;
  },
  get BOT_API_TOKEN() {
    return baseConfig.BOT_API_TOKEN;
  },
  get BOT_DEFAULT_DISK() {
    return baseConfig.BOT_DEFAULT_DISK;
  },
  get BOT_HEADLESS() {
    return baseConfig.BOT_HEADLESS;
  },
  get BOT_LOCALE() {
    return baseConfig.BOT_LOCALE;
  },
  get BOT_TIMEZONE() {
    return baseConfig.BOT_TIMEZONE;
  },
  get BOT_VIEWPORT_WIDTH() {
    return baseConfig.BOT_VIEWPORT_WIDTH;
  },
  get BOT_VIEWPORT_HEIGHT() {
    return baseConfig.BOT_VIEWPORT_HEIGHT;
  },
  get BOT_POLL_INTERVAL_MS() {
    return baseConfig.BOT_POLL_INTERVAL_MS;
  },
  get BOT_CONCURRENCY() {
    return overlay.BOT_CONCURRENCY ?? baseConfig.BOT_CONCURRENCY;
  },
  get BOT_SCAN_PAGE_WAIT_MS() {
    return baseConfig.BOT_SCAN_PAGE_WAIT_MS;
  },
  get BOT_DEBUG_PAUSE_MS() {
    return baseConfig.BOT_DEBUG_PAUSE_MS;
  },
  get BOT_SLOW_MO() {
    return baseConfig.BOT_SLOW_MO;
  },
  get BOT_USE_INSTALLED_CHROME() {
    return baseConfig.BOT_USE_INSTALLED_CHROME;
  },
  get BOT_BROWSER() {
    return baseConfig.BOT_BROWSER;
  },
  get CAPTCHA_SOLVER_ENABLED() {
    return overlay.CAPTCHA_SOLVER_ENABLED ?? baseConfig.CAPTCHA_SOLVER_ENABLED;
  },
  get CAPTCHA_SOLVER_API_KEY() {
    const fromOverlay = overlay.CAPTCHA_SOLVER_API_KEY;
    if (typeof fromOverlay === 'string' && fromOverlay.trim() !== '') {
      return fromOverlay;
    }

    return baseConfig.CAPTCHA_SOLVER_API_KEY;
  },
  get CAPTCHA_SOLVER_PROVIDER() {
    return overlay.CAPTCHA_SOLVER_PROVIDER ?? baseConfig.CAPTCHA_SOLVER_PROVIDER;
  },
};
