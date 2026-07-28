/**
 * Fast URL discovery via robots.txt + sitemaps (HTTP only — no Playwright).
 * Additive helper used by formScanner before the crawl loop.
 */
import { isSameSite, isSkippableAsset, normalizePageUrl, prioritizeLinks } from './formScanUtils';

const SITEMAP_CANDIDATES = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/sitemap-index.xml',
  '/sitemap/sitemap.xml',
] as const;

const FETCH_TIMEOUT_MS = 8000;
const MAX_SITEMAP_FILES = 12;
const MAX_URLS_FROM_SITEMAPS = 400;

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/xml,application/xml,text/plain,*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; LeadSendBot/1.0; +local)',
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractSitemapLocsFromRobots(robotsText: string): string[] {
  const locs: string[] = [];

  for (const line of robotsText.split(/\r?\n/)) {
    const match = /^\s*Sitemap\s*:\s*(\S+)/i.exec(line);
    if (match?.[1]) {
      locs.push(match[1].trim());
    }
  }

  return locs;
}

function extractLocsFromXml(xml: string): string[] {
  const locs: string[] = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(xml)) !== null) {
    const value = match[1]?.trim();
    if (value) {
      locs.push(value);
    }
  }

  return locs;
}

function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

/**
 * Collect same-origin page URLs from robots.txt + sitemaps.
 * Never throws — returns [] on any failure.
 */
export async function discoverUrlsFromRobotsAndSitemaps(startUrl: string): Promise<string[]> {
  let origin: string;

  try {
    origin = new URL(startUrl).origin;
  } catch {
    return [];
  }

  const sitemapQueue: string[] = [];
  const seenSitemaps = new Set<string>();
  const pageUrls: string[] = [];
  const seenPages = new Set<string>();

  const pushSitemap = (raw: string) => {
    try {
      const absolute = new URL(raw, origin).href;
      if (seenSitemaps.has(absolute) || seenSitemaps.size >= MAX_SITEMAP_FILES) {
        return;
      }
      seenSitemaps.add(absolute);
      sitemapQueue.push(absolute);
    } catch {
      // ignore bad URL
    }
  };

  const pushPage = (raw: string) => {
    if (pageUrls.length >= MAX_URLS_FROM_SITEMAPS) {
      return;
    }

    try {
      const absolute = normalizePageUrl(new URL(raw, origin).href);
      if (!isSameSite(absolute, origin) || isSkippableAsset(absolute) || seenPages.has(absolute)) {
        return;
      }
      seenPages.add(absolute);
      pageUrls.push(absolute);
    } catch {
      // ignore
    }
  };

  const robotsText = await fetchText(`${origin}/robots.txt`);
  if (robotsText) {
    for (const loc of extractSitemapLocsFromRobots(robotsText)) {
      pushSitemap(loc);
    }
  }

  if (sitemapQueue.length === 0) {
    for (const path of SITEMAP_CANDIDATES) {
      pushSitemap(`${origin}${path}`);
    }
  }

  while (sitemapQueue.length > 0 && pageUrls.length < MAX_URLS_FROM_SITEMAPS) {
    const sitemapUrl = sitemapQueue.shift();
    if (!sitemapUrl) {
      break;
    }

    const xml = await fetchText(sitemapUrl);
    if (!xml || !/<loc>/i.test(xml)) {
      continue;
    }

    const locs = extractLocsFromXml(xml);

    if (isSitemapIndex(xml)) {
      for (const loc of locs) {
        pushSitemap(loc);
      }
      continue;
    }

    for (const loc of locs) {
      pushPage(loc);
    }
  }

  return prioritizeLinks(pageUrls, startUrl);
}

/** Quick HTML hint check — boost priority, never hard-skip JS forms. */
export async function pageHtmlLooksLikeLeadForm(url: string): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html',
        'User-Agent': 'Mozilla/5.0 (compatible; LeadSendBot/1.0; +local)',
      },
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/html|xml|text/i.test(contentType)) {
      return false;
    }

    const html = (await response.text()).slice(0, 250_000);
    return /<form[\s>]|type=["']?tel|name=["'][^"']*phone|name=["'][^"']*telefon|placeholder=["'][^"']*тел|placeholder=["'][^"']*phone|callback|lead-form|получить\s+предложен|заказать\s+звонок|оставить\s+заявк|тест-?драйв|trade-?in|автокредит/i.test(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
