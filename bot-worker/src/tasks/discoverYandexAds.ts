import pino from 'pino';
import type { Frame, Page } from 'playwright';
import { config } from '../config';
import { closeBrowser, openBrowser } from '../playwright/browser';
import { buildProxyServer, ProxyConfig } from '../services/proxyManager';
import { sendDiscoveryRunResult } from '../services/laravelApi';
import { resolveCaptcha } from '../utils/captchaHandler';
import { humanWarmupScroll } from '../utils/formInteractions';
import { loadYandexStorageState, saveYandexCookies, yandexCookiesDir } from '../utils/yandexCookieStore';

const logger = pino({ name: 'discover-yandex-ads' });

type DiscoverYandexAdsPayload = {
  taskId: number;
  discoveryRunId: number;
  regionId: number;
  regionName: string;
  query: string;
  maxPages?: number;
  proxy?: ProxyConfig | null;
};

type PromoItem = {
  /** Clean site origin without path/query/UTM: https://example.ru */
  url: string;
  /** Full advertiser landing URL with UTM (from snippetUrl). */
  destination_url: string | null;
  /** Yandex click-tracking URL (yabs.yandex.ru/count/...). */
  yandex_url: string | null;
  title: string | null;
  snippet: string | null;
};

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanPause(page: Page, minMs: number, maxMs: number): Promise<void> {
  await page.waitForTimeout(randomInt(minMs, maxMs));
}

export async function discoverYandexAds(payload: DiscoverYandexAdsPayload): Promise<void> {
  const maxPages = Math.max(1, Math.min(5, payload.maxPages ?? 3));
  const query = payload.query?.trim() || `Купить авто в ${payload.regionName}`;

  logger.info(
    {
      discoveryRunId: payload.discoveryRunId,
      regionId: payload.regionId,
      query,
      maxPages,
      hasProxy: Boolean(payload.proxy),
    },
    'Starting Yandex Promo discovery',
  );

  if (!payload.proxy) {
    throw new Error('proxy_required_but_not_available');
  }

  // Prefer real-Chrome headed session; Yandex fingerprints headless/proxy datacenter hard.
  // Cookies after captcha live in storage/yandex-cookies (per proxy) so Yandex asks less often.
  const proxyId = payload.proxy?.id ?? null;
  const storageState = loadYandexStorageState(proxyId);
  logger.info(
    { cookiesDir: yandexCookiesDir(), proxyId, hasStorageState: Boolean(storageState) },
    'Yandex cookie jar',
  );

  const session = await openBrowser(buildProxyServer(payload.proxy), {
    desktopFullScreen: true,
    headless: false,
    storageState,
  });
  const page = await session.context.newPage();
  let blocked = false;
  let blockReason: string | null = null;
  const collected = new Map<string, PromoItem>();
  let pagesScanned = 0;

  const persistCookies = async (reason: string): Promise<void> => {
    await saveYandexCookies(session.context, proxyId, reason);
  };

  // Continuous listener: any jump to /showcaptcha → solve checkbox + icons immediately.
  const captchaWatch = attachShowcaptchaWatcher(page, {
    onSolved: () => persistCookies('after-captcha-solved'),
  });

  try {
    // ya.ru — чистый поиск; yandex.ru часто редиректит на dzen.ru.
    await page.goto('https://ya.ru/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await humanPause(page, 1500, 3200);
    if (!(await captchaWatch.ensureClear())) {
      blocked = true;
      blockReason = captchaWatch.lastError() || 'Яндекс показал капчу на главной';
    } else {
      await persistCookies('after-homepage-clear');
    }
    await dismissYandexOverlays(page);
    await humanWarmupScroll(page).catch(() => undefined);
    await humanPause(page, 600, 1400);

    if (!blocked) {
      const reachedSerp = await submitHomepageSearch(page, query);
      if (!(await captchaWatch.ensureClear())) {
        blocked = true;
        blockReason = captchaWatch.lastError() || 'Яндекс показал капчу после поиска';
      } else if (!reachedSerp) {
        // Fallback: прямой SERP на ya.ru (без захода через dzen/yandex.ru portal).
        const searchUrl = buildYaSearchUrl(query, 0, payload.regionName);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        if (!(await captchaWatch.ensureClear())) {
          blocked = true;
          blockReason = captchaWatch.lastError() || 'Яндекс показал капчу на странице поиска';
        }
      }
    }

    await humanPause(page, 2000, 4000);
    await dismissYandexOverlays(page);

    if (!blocked && !(await captchaWatch.ensureClear())) {
      blocked = true;
      blockReason = captchaWatch.lastError() || 'Яндекс показал капчу или страницу блокировки';
      logger.warn(
        { discoveryRunId: payload.discoveryRunId, url: page.url(), blockReason },
        'Yandex blocked / captcha unresolved after search',
      );
    } else if (!blocked) {
      await persistCookies('before-serp-scan');
    }

    if (!blocked) {
      // Yandex uses 0-based `p`: page 1 has no p / p=0, page 2 is &p=1, page 3 is &p=2, …
      for (let pageOffset = 0; pageOffset < maxPages; pageOffset += 1) {
        pagesScanned = pageOffset + 1;

        if (pageOffset > 0) {
          await goToSerpPageByOffset(page, query, pageOffset, payload.regionName);
          await page.waitForLoadState('domcontentloaded').catch(() => undefined);
          await humanPause(page, 2000, 4000);
        } else {
          await humanPause(page, 1200, 2800);
        }

        if (!(await captchaWatch.ensureClear())) {
          blocked = true;
          blockReason = captchaWatch.lastError() || 'Blocked on showcaptcha during SERP scan';
          logger.warn({ pageOffset, url: page.url(), blockReason }, 'Blocked on showcaptcha during SERP scan');
          break;
        }

        await revealSerpCarousels(page);
        const pageItems = await collectPromoItems(page);
        for (const item of pageItems) {
          // Cross-page dedupe by hostname; yabs-only cards kept until unwrap.
          const key =
            normalizeHostKey(item.url) ||
            normalizeHostKey(item.destination_url || '') ||
            (item.yandex_url ? `yabs:${item.yandex_url.slice(0, 120)}` : null);
          if (!key || collected.has(key)) {
            continue;
          }
          collected.set(key, item);
        }

        logger.info(
          {
            page: pagesScanned,
            p: pageOffset > 0 ? pageOffset : 0,
            foundOnPage: pageItems.length,
            withCleanUrl: pageItems.filter((i) => Boolean(normalizeHostKey(i.url))).length,
            withYabs: pageItems.filter((i) => Boolean(i.yandex_url)).length,
            totalUnique: collected.size,
            sample: pageItems.slice(0, 3).map((i) => ({
              url: i.url || null,
              dest: i.destination_url ? i.destination_url.slice(0, 80) : null,
              yabs: Boolean(i.yandex_url),
              title: i.title?.slice(0, 40) || null,
            })),
          },
          pageItems.length === 0
            ? 'No Promo blocks on this SERP page — continuing'
            : 'Yandex SERP page scanned',
        );
      }
    }

    const resolved: PromoItem[] = [];
    for (const item of collected.values()) {
      const originalYandex =
        item.yandex_url ||
        (/yabs\.yandex|an\.yandex|ads\.yandex/i.test(item.url) ? item.url : null);

      let destinationUrl = item.destination_url;
      let cleanUrl = item.url;

      // If we only have yabs — unwrap to get full landing (with UTM) + clean origin.
      if ((!destinationUrl || /yabs\.yandex|an\.yandex|ads\.yandex/i.test(destinationUrl)) && originalYandex) {
        const unwrapped = await resolveDestinationUrl(page, originalYandex);
        if (unwrapped) {
          destinationUrl = unwrapped.full;
          cleanUrl = unwrapped.origin;
        }
      }

      const origin = toOrigin(cleanUrl) || toOrigin(destinationUrl || '');
      if (!origin || /yabs\.yandex|an\.yandex|ads\.yandex/i.test(origin)) {
        // Keep trying yabs unwrap already done above; skip only if still no clean site.
        continue;
      }

      const adLanding =
        destinationUrl && !/yabs\.yandex|an\.yandex|ads\.yandex/i.test(destinationUrl)
          ? destinationUrl
          : null;
      // Prefer UTM landing, else yabs track, else clean origin (still a usable promo hit).
      const yandexUrl = originalYandex;
      if (!adLanding && !yandexUrl && !origin) {
        continue;
      }

      // Re-key by clean host after unwrap (merge duplicates across yabs keys).
      const hostKey = normalizeHostKey(origin);
      if (!hostKey) continue;
      if (resolved.some((r) => normalizeHostKey(r.url) === hostKey)) continue;

      resolved.push({
        ...item,
        url: origin,
        destination_url: adLanding,
        yandex_url: yandexUrl,
      });
    }

    logger.info(
      {
        discoveryRunId: payload.discoveryRunId,
        collected: collected.size,
        resolved: resolved.length,
      },
      'Resolved promo destinations',
    );

    const payloadItems = resolved
      .filter((item) => Boolean(item.url || item.destination_url || item.yandex_url))
      .map((item) => ({
        url: item.url || item.destination_url || '',
        destination_url: item.destination_url,
        yandex_url: item.yandex_url,
        title: item.title,
        snippet: item.snippet,
      }))
      .filter((item) => item.url !== '');

    await sendDiscoveryRunResult(payload.discoveryRunId, {
      items: payloadItems,
      pages_scanned: Math.max(pagesScanned, blocked ? 1 : 0),
      blocked,
      error_message: blocked
        ? (blockReason || captchaWatch.lastError() || 'Яндекс показал капчу или страницу блокировки')
        : null,
    });

    logger.info(
      {
        discoveryRunId: payload.discoveryRunId,
        found: payloadItems.length,
        pagesScanned,
        blocked,
        blockReason,
      },
      'Yandex Promo discovery finished',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: error }, 'Yandex discovery crashed — sending partial result');
    blocked = true;
    blockReason = blockReason || message;
    const partialItems = [...collected.values()]
      .map((item) => ({
        url: item.url || toOrigin(item.destination_url || '') || '',
        destination_url: item.destination_url,
        yandex_url: item.yandex_url,
        title: item.title,
        snippet: item.snippet,
      }))
      .filter((item) => item.url !== '');
    await sendDiscoveryRunResult(payload.discoveryRunId, {
      items: partialItems,
      pages_scanned: Math.max(pagesScanned, 1),
      blocked: true,
      error_message: message,
    }).catch(() => undefined);
  } finally {
    captchaWatch.stop();

    await persistCookies('session-end').catch(() => undefined);

    const pauseMs = config.BOT_DEBUG_PAUSE_MS > 0
      ? config.BOT_DEBUG_PAUSE_MS
      : (blocked ? 20000 : 0);

    if (pauseMs > 0) {
      logger.info({ pauseMs, blocked }, 'Debug pause before closing browser');
      await page.waitForTimeout(pauseMs);
    }

    await closeBrowser(session);
  }
}

async function submitHomepageSearch(page: Page, query: string): Promise<boolean> {
  const input = page.locator(
    'input#text, input[name="text"], input.search__input, input[aria-label*="найд" i], textarea[name="text"]',
  ).first();

  if ((await input.count()) < 1) {
    return false;
  }

  await input.click({ timeout: 5000 }).catch(() => undefined);
  await humanPause(page, 300, 700);
  await input.fill('');
  // Type slowly — less bot-like than fill().
  await input.pressSequentially(query, { delay: randomInt(45, 110) }).catch(async () => {
    await input.fill(query);
  });
  await humanPause(page, 400, 900);
  await page.keyboard.press('Enter');
  // Wait for navigation after Enter — avoid evaluate during destroy.
  await Promise.race([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined),
    page.waitForURL(/\/search\//i, { timeout: 30000 }).catch(() => undefined),
  ]);
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await humanPause(page, 1500, 2800);

  return /yandex\.ru\/search|ya\.ru\/search/i.test(page.url());
}

async function trySolveYandexChallenge(page: Page): Promise<{ ok: boolean; error: string | null }> {
  try {
    logger.info({ url: page.url() }, 'Attempting to solve Yandex showcaptcha / SmartCaptcha');

    const solved = await resolveCaptcha(
      page,
      page.locator('body'),
      {
        captcha_type: 'yandex_smartcaptcha',
        captcha_yandex_mode: 'checkbox',
        captcha_iframe_selector:
          'iframe[data-testid="advanced-iframe"], iframe[data-testid="checkbox-iframe"], iframe[src*="smartcaptcha"], iframe[src*="captcha.yandex"], iframe[src*="checkbox"]',
        captcha_checkbox_selector:
          '#js-button, .CheckboxCaptcha-Button, [role="checkbox"], #captcha-slider, [data-testid="thumb"]',
        captcha_token_selector: 'input[name="smart-token"]',
      },
      {
        appearTimeoutMs: 12000,
        phase: 'post-submit',
      },
    );

    if (solved) {
      await humanPause(page, 1500, 3000);
      // After checkbox + icons, Yandex redirects back to search via retpath.
      // Do NOT reject URLs that merely mention showcaptcha in utm_referrer.
      await page.waitForURL((url) => {
        try {
          const parsed = new URL(url.toString());
          return /\/search\//i.test(parsed.pathname) && !/\/(showcaptcha|checkcaptcha)\/?$/i.test(parsed.pathname);
        } catch {
          return /\/search\//i.test(url.toString());
        }
      }, {
        timeout: 25000,
      }).catch(() => undefined);

      if (!(await isYandexBlocked(page))) {
        logger.info({ url: page.url() }, 'Yandex challenge cleared');

        return { ok: true, error: null };
      }

      return { ok: false, error: 'Капча не снята после решения (остались на showcaptcha)' };
    }

    return { ok: false, error: 'Не удалось решить капчу Яндекса' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ err: error }, 'Yandex challenge solve failed');
    return { ok: false, error: message };
  }
}

function isShowcaptchaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only the actual captcha page path — NOT utm_referrer=.../showcaptcha in search URLs.
    return /\/(showcaptcha|checkcaptcha)\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * Persistent listener: as soon as the address bar becomes /showcaptcha?...
 * (pathname only), solve checkbox + icons captcha via ruCaptcha.
 */
function attachShowcaptchaWatcher(
  page: Page,
  options?: { onSolved?: () => void | Promise<void> },
): {
  ensureClear: () => Promise<boolean>;
  lastError: () => string | null;
  stop: () => void;
} {
  let stopped = false;
  let activeSolve: Promise<void> | null = null;
  let lastHandledUrl = '';
  let lastError: string | null = null;

  const triggerSolve = (reason: string): Promise<void> => {
    if (stopped) {
      return Promise.resolve();
    }

    // Already solving — wait for the same promise (do not start a second solve).
    if (activeSolve) {
      return activeSolve;
    }

    const url = page.url();
    if (!isShowcaptchaUrl(url) && reason === 'poll') {
      return Promise.resolve();
    }

    if (isShowcaptchaUrl(url) && url === lastHandledUrl && reason !== 'ensure') {
      return Promise.resolve();
    }

    lastHandledUrl = isShowcaptchaUrl(url) ? url : lastHandledUrl;

    activeSolve = (async () => {
      try {
        logger.warn({ url: page.url(), reason }, 'Showcaptcha URL detected — auto-solving');
        const result = await trySolveYandexChallenge(page);
        if (result.ok) {
          lastError = null;
          lastHandledUrl = '';
          logger.info({ url: page.url() }, 'Showcaptcha auto-solved');
          await options?.onSolved?.();
        } else {
          lastError = result.error || 'Не удалось решить капчу Яндекса';
          logger.warn({ url: page.url(), error: lastError }, 'Showcaptcha auto-solve failed');
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        logger.warn({ err: error }, 'Showcaptcha watcher error');
      } finally {
        activeSolve = null;
      }
    })();

    return activeSolve;
  };

  const onFrameNavigated = (frame: Frame): void => {
    if (stopped || frame !== page.mainFrame()) {
      return;
    }

    const url = frame.url();
    if (isShowcaptchaUrl(url)) {
      void triggerSolve('framenavigated');
    }
  };

  page.on('framenavigated', onFrameNavigated);

  const pollId = setInterval(() => {
    if (stopped) {
      return;
    }
    if (isShowcaptchaUrl(page.url())) {
      void triggerSolve('poll');
    }
  }, 800);

  return {
    async ensureClear(): Promise<boolean> {
      const deadline = Date.now() + 180_000;

      while (!stopped && Date.now() < deadline) {
        if (activeSolve) {
          await activeSolve.catch(() => undefined);
        }

        let url = '';
        try {
          url = page.url();
        } catch {
          await page.waitForTimeout(500);
          continue;
        }

        if (isShowcaptchaUrl(url)) {
          await triggerSolve('ensure');
          await page.waitForTimeout(400);
          continue;
        }

        if (await isYandexBlocked(page)) {
          // UI captcha without /showcaptcha path — give solver a moment / retry.
          await page.waitForTimeout(1000);
          if (isShowcaptchaUrl(page.url())) {
            continue;
          }
          return false;
        }

        return true;
      }

      return !(await isYandexBlocked(page));
    },
    lastError(): string | null {
      return lastError;
    },
    stop(): void {
      stopped = true;
      page.off('framenavigated', onFrameNavigated);
      clearInterval(pollId);
    },
  };
}

async function dismissYandexOverlays(page: Page): Promise<void> {
  const candidates = [
    page.getByRole('button', { name: /принять|согласен|хорошо|закрыть|понятно|не сейчас/i }),
    page.locator('button').filter({ hasText: /принять|согласен|хорошо|понятно|не сейчас/i }),
  ];

  for (const locator of candidates) {
    const first = locator.first();
    if ((await first.count()) > 0 && (await first.isVisible().catch(() => false))) {
      await first.click({ timeout: 2000 }).catch(() => undefined);
      await page.waitForTimeout(400);
      break;
    }
  }
}

async function isYandexBlocked(page: Page): Promise<boolean> {
  try {
    // Page may be mid-navigation (search submit / captcha redirect) — wait briefly.
    await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => undefined);

    let url = '';
    try {
      url = page.url();
    } catch {
      return false;
    }

    // Real captcha page only (pathname). Search URLs often keep showcaptcha in utm_referrer.
    if (isShowcaptchaUrl(url)) {
      return true;
    }

    const onSearch = /\/search\//i.test(url);

    const visibleCaptchaUi = await page.evaluate(() => {
      const selectors = [
        '#checkbox-captcha-form',
        '.CheckboxCaptcha-Button',
        '[data-testid="checkbox-captcha"]',
        '.AdvancedCaptcha-SilhouetteTask',
        '.AdvancedCaptcha_image',
        'iframe[data-testid="advanced-iframe"]',
      ];

      for (const selector of selectors) {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) continue;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
        if (rect.width < 8 || rect.height < 8) continue;
        return true;
      }

      return false;
    }).catch(() => false);

    if (visibleCaptchaUi) {
      return true;
    }

    if (onSearch) {
      return false;
    }

    return await page.evaluate(() => {
      const text = (document.body?.innerText || '').slice(0, 2500);
      return /подтвердите,? что запросы отправляли вы|доступ временно ограничен/i.test(text);
    }).catch(() => false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Navigation mid-check is common on Yandex — not a hard block.
    if (/Execution context was destroyed|Target closed|Navigation/i.test(message)) {
      logger.warn({ message }, 'isYandexBlocked skipped during navigation');
      return false;
    }
    logger.warn({ err: error }, 'isYandexBlocked unexpected error');
    return false;
  }
}

async function collectPromoItems(page: Page): Promise<PromoItem[]> {
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
  // Wait for SERP list if present.
  await page.waitForSelector('#search-result, ul.serp-list, ul[aria-label*="Результат" i]', {
    timeout: 12000,
  }).catch(() => undefined);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await page.evaluate(() => {
    const SKIP_HOSTS = new Set([
      'yandex.ru',
      'ya.ru',
      'yandex.com',
      'yabs.yandex.ru',
      'an.yandex.ru',
      'ads.yandex.ru',
      'google.com',
      'google.ru',
    ]);

    /** Strict ASCII hostname — rejects Path crumbs with › and Cyrillic. */
    function sanitizeHost(raw: string): string | null {
      const head = raw.split(/[›»▸·|/\s]/)[0]?.trim() || '';
      const match = head.match(
        /^(?:https?:\/\/)?(?:www\.)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/i,
      );
      if (!match) return null;
      const host = match[1].toLowerCase();
      if (!/^[a-z0-9.-]+$/.test(host)) return null;
      if (SKIP_HOSTS.has(host) || host.includes('yandex') || host.endsWith('.ya.ru')) return null;
      return host;
    }

    function hostOf(href: string): string | null {
      try {
        const u = new URL(href, location.href);
        return sanitizeHost(u.hostname);
      } catch {
        return sanitizeHost(href);
      }
    }

    function toOrigin(href: string): string | null {
      const host = hostOf(href);
      if (!host) return null;
      try {
        const u = new URL(href, location.href);
        if (!/^https?:$/i.test(u.protocol)) return null;
        if (SKIP_HOSTS.has(host) || host.endsWith('.yandex.ru') || host.endsWith('.yandex.net')) {
          return null;
        }
        return `https://${host}`;
      } catch {
        return host ? `https://${host}` : null;
      }
    }

    function isYandexTrackUrl(href: string): boolean {
      return /yabs\.yandex\.ru\/count|an\.yandex\.ru|ads\.yandex/i.test(href);
    }

    function isExternalSiteUrl(href: string): boolean {
      return toOrigin(href) !== null;
    }

    /** Top carousel / horizontal scroller — skip entirely (class names change often). */
    function isInsideCarousel(el: Element): boolean {
      let node: Element | null = el;
      while (node && node !== document.body) {
        const cls = typeof (node as HTMLElement).className === 'string'
          ? (node as HTMLElement).className
          : '';
        if (/scroller/i.test(cls)) return true;
        const role = node.getAttribute('aria-roledescription') || '';
        if (/carousel|карусел/i.test(role)) return true;
        node = node.parentElement;
      }
      return false;
    }

    function getSerpList(): Element | null {
      return (
        document.querySelector('#search-result') ||
        document.querySelector('ul[aria-label*="Результат" i]') ||
        document.querySelector('ul.serp-list')
      );
    }

    /** Advertiser landing with UTM from Extralinks data-vnl snippetUrl */
    function extractSnippetUrl(card: Element): string | null {
      for (const btn of card.querySelectorAll('button[data-vnl], [data-vnl]')) {
        const raw = btn.getAttribute('data-vnl');
        if (!raw) continue;
        try {
          const data = JSON.parse(raw) as {
            items?: Array<{
              reportFeedback?: {
                customMetaFields?: Array<{ name?: string; value?: string }>;
              };
            }>;
          };
          for (const item of data.items || []) {
            const fields = item.reportFeedback?.customMetaFields || [];
            const snippet = fields.find((f) => f.name === 'snippetUrl')?.value;
            if (snippet && isExternalSiteUrl(snippet)) {
              return snippet;
            }
          }
        } catch {
          // ignore bad JSON
        }
      }
      return null;
    }

    function extractYandexUrl(card: Element): string | null {
      for (const a of card.querySelectorAll('a[href]')) {
        const href = (a as HTMLAnchorElement).href;
        if (isYandexTrackUrl(href)) return href;
      }
      return null;
    }

    /** Domain from Path / green URL text — never "site.ru›Title…" as whole URL. */
    function extractDomainFallback(card: Element): string | null {
      const candidates: string[] = [];

      for (const el of card.querySelectorAll('a, b, span, cite')) {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length > 160) continue;
        if (/\.[a-z]{2,}/i.test(text) || /[›»]/.test(text) || /^(?:www\.)?[a-z0-9-]+\.[a-z]{2,}/i.test(text)) {
          candidates.push(text);
        }
      }

      // Full card text sometimes has "example.ru › …" once.
      const blob = (card.textContent || '').replace(/\s+/g, ' ').trim();
      const pathMatch = blob.match(
        /((?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)\s*[›»]/i,
      );
      if (pathMatch) candidates.unshift(pathMatch[1]);

      for (const raw of candidates) {
        const host = sanitizeHost(raw);
        if (host) return `https://${host}`;
      }

      return null;
    }

    function isPromoCard(card: Element): boolean {
      // Label text «Промо» / «Реклама» — do not depend on specific class names.
      if (card.querySelector('.AdvLabel, .OrganicAdvLabel, [class*="AdvLabel"]')) {
        return true;
      }
      for (const el of card.querySelectorAll('span, div, a')) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (/^(Промо|Реклама)$/i.test(t)) return true;
      }
      const head = (card.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500);
      return /\bПромо\b|\bРеклама\b/i.test(head);
    }

    function isCarouselShell(el: Element): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const cls = el.className || '';
      return Boolean(
        el.querySelector(':scope > [class*="Scroller"], :scope > [class*="scroller"]')
        || (/Futuris|Root-Futuris/i.test(cls)
          && el.querySelector('[class*="Scroller"], [class*="scroller"]')),
      );
    }

    function looksLikeSiteCard(card: Element): boolean {
      if (isPromoCard(card)) return true;
      if (extractYandexUrl(card) && extractDomainFallback(card)) return true;
      if (extractSnippetUrl(card)) return true;
      // Compact carousel tile: domain path + title, no organic article body.
      const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 12 || text.length > 400) return false;
      return Boolean(extractDomainFallback(card));
    }

    /** Promo cards inside top horizontal site carousel / Futuris scroller. */
    function collectCarouselCards(): Element[] {
      const out: Element[] = [];
      const seen = new Set<Element>();

      const scrollers = [
        ...document.querySelectorAll(
          '[class*="Scroller"], [class*="scroller"], [aria-roledescription*="carousel" i], [aria-roledescription*="карусел" i]',
        ),
      ];

      for (const scroller of scrollers) {
        const shell = scroller.closest('li') || scroller.parentElement || scroller;
        const shellIsPromo = isPromoCard(shell) || isPromoCard(scroller);
        const candidates = scroller.querySelectorAll(
          '[class*="Organic"], [class*="organic"], [class*="Snippet"], [class*="Card"], [class*="Ecom"], [role="listitem"], li',
        );

        for (const card of candidates) {
          if (seen.has(card)) continue;
          // Skip huge containers that wrap the whole scroller.
          if (card.contains(scroller)) continue;
          if ((card.textContent || '').length > 800) continue;
          // Skip non-ad recommendation tiles ("Может заинтересовать") without Промо label.
          const head = (card.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
          if (/^Может заинтересовать/i.test(head) && !isPromoCard(card)) continue;
          if (!looksLikeSiteCard(card) && !shellIsPromo) continue;
          // If shell is a promo carousel, keep cards that resolve to a site.
          if (shellIsPromo && !extractDomainFallback(card) && !extractYandexUrl(card) && !extractSnippetUrl(card)) {
            continue;
          }
          if (!shellIsPromo && !isPromoCard(card) && !extractYandexUrl(card)) {
            continue;
          }
          seen.add(card);
          out.push(card);
        }
      }

      return out;
    }

    const list = getSerpList();
    const cards: Element[] = [];
    const seenCards = new Set<Element>();

    if (list) {
      // Main SERP: direct li children with Промо/Реклама (skip carousel shells — handled separately).
      for (const child of Array.from(list.children)) {
        if (!(child instanceof HTMLElement) || child.tagName !== 'LI') continue;
        if (isCarouselShell(child) || isInsideCarousel(child)) continue;
        if (!isPromoCard(child)) continue;
        seenCards.add(child);
        cards.push(child);
      }
    }

    for (const card of collectCarouselCards()) {
      if (seenCards.has(card)) continue;
      seenCards.add(card);
      cards.push(card);
    }

    // Fallback if #search-result missing: any li that looks like a result card.
    if (cards.length === 0) {
      for (const node of document.querySelectorAll('li[data-cid], li.serp-item, li')) {
        if (!node.closest('ul')) continue;
        if (!isPromoCard(node) && !extractYandexUrl(node)) continue;
        if (seenCards.has(node)) continue;
        seenCards.add(node);
        cards.push(node);
      }
    }

    const items: Array<{
      url: string;
      destination_url: string | null;
      yandex_url: string | null;
      title: string | null;
      snippet: string | null;
    }> = [];
    const seen = new Set<string>();

    for (const card of cards) {
      const titleEl = card.querySelector('h2');
      let title = (titleEl?.textContent || '').replace(/\s+/g, ' ').trim() || null;
      if (title) title = title.replace(/^(Промо|Реклама)\s+/i, '').trim() || null;

      // Short text block under title — avoid class names.
      let snippet: string | null = null;
      const paragraphs = card.querySelectorAll('span, div');
      for (const el of paragraphs) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t.length >= 40 && t.length <= 280 && !/^(Промо|Реклама)$/i.test(t) && t !== title) {
          snippet = t;
          break;
        }
      }

      const yandexUrl = extractYandexUrl(card);
      const destinationUrl = extractSnippetUrl(card);

      let cleanUrl =
        (destinationUrl ? toOrigin(destinationUrl) : null) ||
        extractDomainFallback(card);

      if (!cleanUrl) {
        for (const a of card.querySelectorAll('a[href]')) {
          const href = (a as HTMLAnchorElement).href;
          const origin = toOrigin(href);
          if (origin) {
            cleanUrl = origin;
            break;
          }
        }
      }

      // Need clean site OR yabs (resolved later). Never store Path crumb text as url.
      if (!cleanUrl && !yandexUrl) continue;

      const key = (cleanUrl ? hostOf(cleanUrl) : null) || hostOf(destinationUrl || '') || yandexUrl || '';
      const keyNorm = key.toLowerCase();
      if (!keyNorm || seen.has(keyNorm)) continue;
      seen.add(keyNorm);

      items.push({
        url: cleanUrl || '',
        destination_url: destinationUrl,
        yandex_url: yandexUrl,
        title,
        snippet,
      });
    }

    return items;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ attempt, message }, 'collectPromoItems evaluate failed');
      if (!/Execution context was destroyed|Target closed|Navigation/i.test(message) || attempt === 3) {
        return [];
      }
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(800);
    }
  }

  return [];
}

/** Navigate SERP by Yandex page offset: p=1 → 2nd page, p=2 → 3rd, etc. */
async function goToSerpPageByOffset(
  page: Page,
  query: string,
  pageOffset: number,
  regionName?: string,
): Promise<void> {
  const url = new URL(page.url());
  const isSearch = /yandex\.ru\/search|ya\.ru\/search/i.test(url.href);

  if (isSearch) {
    url.searchParams.set('text', query);
    if (pageOffset > 0) {
      url.searchParams.set('p', String(pageOffset));
    } else {
      url.searchParams.delete('p');
    }
    const lr = regionLrFromName(regionName);
    if (lr) {
      url.searchParams.set('lr', lr);
    }
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    return;
  }

  await page.goto(buildYaSearchUrl(query, pageOffset, regionName), {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
}

/** Scroll horizontal promo carousels so lazy site cards mount in DOM. */
async function revealSerpCarousels(page: Page): Promise<void> {
  try {
    await page.evaluate(`(() => {
      const scrollers = document.querySelectorAll(
        '[class*="Scroller"], [class*="scroller"], [aria-roledescription*="carousel" i], [aria-roledescription*="карусел" i]',
      );
      for (const node of scrollers) {
        if (!(node instanceof HTMLElement)) continue;
        const max = Math.max(0, node.scrollWidth - node.clientWidth);
        if (max < 40) continue;
        const step = Math.max(120, Math.floor(node.clientWidth * 0.7));
        for (let x = 0; x <= max; x += step) {
          node.scrollLeft = x;
        }
        node.scrollLeft = 0;
      }
    })()`);
    await page.waitForTimeout(600);
  } catch {
    // ignore
  }
}

function regionLrFromName(regionName?: string): string | null {
  const name = (regionName || '').trim().toLowerCase();
  if (!name) return null;

  const map: Array<[RegExp, string]> = [
    [/москв/, '213'],
    [/санкт|питер|спб/, '2'],
    [/краснодар/, '35'],
    [/сочи/, '239'],
    [/ростов/, '39'],
    [/екатеринбург/, '54'],
    [/новосибирск/, '65'],
    [/казан/, '43'],
    [/самар/, '51'],
    [/воронеж/, '193'],
    [/красноярск/, '62'],
    [/уфа|башкортостан/, '172'],
    [/пермь/, '50'],
    [/челябинск/, '56'],
    [/тюмен/, '55'],
    [/иркутск/, '63'],
    [/хабаровск/, '76'],
    [/владивосток/, '75'],
    [/калининград/, '22'],
    [/нижн.*новгород/, '47'],
  ];

  for (const [re, lr] of map) {
    if (re.test(name)) return lr;
  }

  return null;
}

function buildYaSearchUrl(query: string, pageOffset = 0, regionName?: string): string {
  const searchUrl = new URL('https://ya.ru/search/');
  searchUrl.searchParams.set('text', query);
  if (pageOffset > 0) {
    searchUrl.searchParams.set('p', String(pageOffset));
  }
  const lr = regionLrFromName(regionName);
  if (lr) {
    searchUrl.searchParams.set('lr', lr);
  }
  return searchUrl.toString();
}

async function resolveDestinationUrl(
  page: Page,
  url: string,
): Promise<{ full: string; origin: string } | null> {
  if (!/yabs\.yandex|an\.yandex|ads\.yandex/i.test(url)) {
    const origin = toOrigin(url);
    return origin ? { full: url, origin } : null;
  }

  try {
    const response = await page.context().request.get(url, {
      maxRedirects: 5,
      timeout: 15000,
    });
    const finalUrl = response.url();
    if (finalUrl && /^https?:/i.test(finalUrl) && !/yandex\.(ru|com|net)/i.test(finalUrl)) {
      const origin = toOrigin(finalUrl);
      if (origin) {
        return { full: finalUrl, origin };
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function sanitizeHostname(raw: string): string | null {
  const text = (raw || '').trim();
  if (!text) return null;

  // Prefer URL parser — never split "https://host/path" on "/" (that left only "https:").
  try {
    const withProto = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const host = new URL(withProto).hostname.replace(/^www\./i, '').toLowerCase();
    if (/^[a-z0-9.-]+$/.test(host) && host.includes('.') && !host.includes('yandex') && host !== 'ya.ru') {
      return host;
    }
  } catch {
    // fall through to crumb parsing
  }

  // Path crumbs like "site.ru › Title" or bare "www.site.ru".
  const head = text.split(/[›»▸·|\s]/)[0]?.trim() || '';
  const match = head.match(
    /^(?:https?:\/\/)?(?:www\.)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/i,
  );
  if (!match) return null;
  const host = match[1].toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes('yandex') || host === 'ya.ru') return null;
  return host;
}

function toOrigin(url: string): string | null {
  const host = sanitizeHostname(url);
  if (!host) return null;
  return `https://${host}`;
}

function normalizeHostKey(url: string): string | null {
  return sanitizeHostname(url);
}
