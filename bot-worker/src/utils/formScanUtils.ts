export const DEFAULT_MAX_FORMS_PER_SITE = 5;
export const MAX_FORMS_PER_SITE = 10;
/** Flexible scan: crawl several high-value internal pages by default. */
export const MAX_PAGES_TO_CRAWL = 8;
/** Agent / deep crawl mode. */
export const MAX_PAGES_MULTI_CRAWL = 40;
export const MAX_LINKS_PER_PAGE = 40;
/** Max CTA/modal triggers to try per page. */
export const MAX_MODAL_TRIGGERS_PER_PAGE = 8;

/** URL score weights — used by prioritizeLinks / crawl queue. */
export const URL_SCORE_MODEL_CARD = 40;
export const URL_SCORE_BRAND_LISTING = 18;
export const URL_SCORE_CATALOG_HINT = 22;
export const URL_SCORE_OFFER_PAGE = 16;
export const URL_SCORE_CONTACT_PAGE = 10;
export const URL_SCORE_HOMEPAGE = 6;
export const URL_SCORE_DEALER_BRAND = 12;
export const URL_SCORE_HTML_LEAD_HINT = 15;
export const URL_SCORE_LOW_VALUE = -40;
export const URL_SCORE_DEPTH_PENALTY_MAX = 4;

/** Common dealer brand path segments (RU multi-brand sites). */
export const DEALER_BRAND_SLUGS = [
  'kia',
  'hyundai',
  'renault',
  'nissan',
  'toyota',
  'mazda',
  'chery',
  'geely',
  'haval',
  'changan',
  'exeed',
  'omoda',
  'jaecoo',
  'bmw',
  'mercedes',
  'audi',
  'volkswagen',
  'vw',
  'skoda',
  'lada',
  'vaz',
  'uaz',
  'suzuki',
  'mitsubishi',
  'honda',
  'subaru',
  'lexus',
  'volvo',
  'gac',
  'tank',
  'jetour',
  'jetta',
  'belgee',
  'sollers',
  'moskvich',
  'evolute',
  'voyah',
  'zeekr',
  'hongqi',
  'cadillac',
  'chevrolet',
  'ford',
  'opel',
  'peugeot',
  'citroen',
  'ravon',
  'dongfeng',
  'faw',
  'bestune',
  'solaris',
] as const;

const CONTACT_PATH_PATTERN =
  /(callback|feedback|kontakt|обратн|заявк|звонок|booking|testdrive|test-drive|credit|кредит|autocredit|автокредит|trade-?in|tradein|exchange|обмен|installments?|рассрочк)/i;

const OFFER_PATH_PATTERN =
  /(special-?offers?|akcii|акци|promo|actions?|offer|предложен|скидк)/i;

/** Automotive path hints (catalog / stock / cars). */
const AUTO_PATH_HINT_PATTERN =
  /\/(?:car|cars|auto|automobile|catalog|catalogue|model|models|vehicle|vehicles|stock|new|used|sale|avto|avtomobili|mashina|marka|modeli|komplektaciya|generation|offer|offers|catalog-auto|avto-v-nalichii|cars-in-stock|coche)(?:\/|$)/i;

/** Low-value / utility pages — heavily demote. */
const LOW_VALUE_PATH_PATTERN =
  /\/(?:about|o-kompanii|o-nas|news|novosti|blog|privacy|policy|politika|terms|cookie|cookies|vacancy|vacancies|vakans|sitemap|login|register|auth|cabinet|lk|personal|404|favorites|wishlist|cart|basket)(?:\/|$)/i;

/**
 * Offer / vehicle detail cards (forms live here).
 * Carmir: /used/volvo/s80/ii-restailing-2009-2013/845500
 * Others: /auto/kia/rio/123, /kia/rio/456
 * Not an offer: /used/peugeot/408 (numeric model name, filter listing).
 */
const OFFER_ID_SEGMENT = /^\d{4,}$/;

function pathSegments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

/** Legacy model pages without numeric id (not stock filter listings). */
const MODEL_CARD_PATH_PATTERN =
  /\/(?:auto|cars|catalog|stock|coche|avtomobili|avto)\/[a-z0-9_-]+\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)?\/?(?:$|\?|#)|\/models?\/[a-z0-9_-]+\/?(?:$|\?|#)|\/(?:kia|hyundai|geely|chery|haval|omoda|jaecoo|exeed|changan|lada|toyota|bmw|audi|mazda|renault|nissan|volkswagen|vw|skoda|belgee|moskvich|tank|jetour|volvo|ford|opel|mitsubishi|suzuki|honda|infiniti|porsche|land-rover|lifan)\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)?\/?(?:$|\?|#)/i;

/** Stock catalog roots where brand/model filters share one template (no lead modal). */
const STOCK_CATALOG_ROOT = /^\/(?:used|new|sale|stock)(?:\/|$)/i;

const TRACKING_QUERY_KEYS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'yclid',
  'ysclid',
  'gclid',
  'fbclid',
  '_openstat',
  'rb_clickid',
  'from',
]);

export function dealerBrandPathRegex(): RegExp {
  return new RegExp(`(?:^|/)(?:${DEALER_BRAND_SLUGS.join('|')})(?:/|$|-)`, 'i');
}

export function isDealerBrandUrl(url: string): boolean {
  try {
    return dealerBrandPathRegex().test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function clampMaxFormsPerSite(value?: number): number {
  if (value === undefined || Number.isNaN(value)) {
    return DEFAULT_MAX_FORMS_PER_SITE;
  }

  return Math.max(1, Math.min(MAX_FORMS_PER_SITE, Math.floor(value)));
}

export function normalizePageUrl(url: string): string {
  const parsed = new URL(url);
  // Keep meaningful SPA hashes (car/model sections), drop empty/#top noise.
  if (!parsed.hash || parsed.hash.length <= 2 || /^#(top|modal|popup|close)?$/i.test(parsed.hash)) {
    parsed.hash = '';
  }

  if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  // Drop tracking params so the same card is not crawled twice.
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_QUERY_KEYS.has(key.toLowerCase()) || /^utm_/i.test(key)) {
      parsed.searchParams.delete(key);
    }
  }

  return parsed.href;
}

export function isSameSite(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

export function isSkippableAsset(url: string): boolean {
  return (
    /\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|rar|doc|docx|xls|xlsx|mp4|mp3|avi|mov)(\?|$)/i.test(url)
    || /[?&](arrFilter|set_filter|PAGEN_|bxajaxid)=/i.test(url)
    || /\/(favorites|privacy|policy|cookie|personal|login|cart|basket|wishlist|vacancy|vakans)(\/|$|-)/i.test(url)
  );
}

export function isLowValueUrl(url: string): boolean {
  try {
    return LOW_VALUE_PATH_PATTERN.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function prioritizeLinks(links: string[], baseUrl: string): string[] {
  const origin = new URL(baseUrl).origin;
  const unique = [...new Set(links.map((link) => normalizePageUrl(link)).filter((link) => isSameSite(link, origin) && !isSkippableAsset(link)))];

  return unique.sort((left, right) => scoreLink(right, baseUrl) - scoreLink(left, baseUrl));
}

/** Insert URLs into a queue keeping score order (no full re-sort of huge lists when possible). */
export function enqueuePrioritized(queue: string[], urls: string[], baseUrl: string, visited: Set<string>): void {
  const origin = new URL(baseUrl).origin;
  const existing = new Set(queue.map((item) => normalizePageUrl(item)));

  for (const raw of prioritizeLinks(urls, baseUrl)) {
    const url = normalizePageUrl(raw);
    if (visited.has(url) || existing.has(url) || !isSameSite(url, origin) || isSkippableAsset(url)) {
      continue;
    }

    if (isLowValueUrl(url) && !isModelCardUrl(url)) {
      // Keep at the very end as last resort.
      queue.push(url);
      existing.add(url);
      continue;
    }

    // Insert before first item with lower score.
    const score = scoreLink(url, baseUrl);
    let inserted = false;

    for (let index = 0; index < queue.length; index += 1) {
      if (scoreLink(queue[index], baseUrl) < score) {
        queue.splice(index, 0, url);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      queue.push(url);
    }

    existing.add(url);
  }
}

/** Paths where dealer lead forms usually live — always try these early. */
export function seedHighValueUrls(baseUrl: string): string[] {
  const origin = new URL(baseUrl).origin;
  // Keep short: missing seeds 404 and must not burn the crawl budget.
  const paths = [
    '/used',
    '/new',
    '/credit',
    '/autocredit',
    '/trade-in',
    '/tradein',
    '/exchange',
    '/installments',
    '/callback',
    '/contacts',
    '/auto',
    '/cars',
    '/catalog',
    '/coche',
    '/avtomobili',
  ];

  return paths.map((path) => normalizePageUrl(`${origin}${path}`));
}

export function isOfferCardUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathSegments(pathname);
    const last = parts[parts.length - 1] ?? '';

    // /used|/new|/sale|/stock trees: offer id sits after brand/model(/generation).
    // /used/peugeot/408 — numeric model filter (3 segments), not a card.
    // /used/volvo/xc70/ii-2007-2013/730333 — real card (5 segments).
    if (STOCK_CATALOG_ROOT.test(pathname)) {
      if (!OFFER_ID_SEGMENT.test(last)) {
        return false;
      }

      if (parts.length <= 3) {
        return false;
      }

      // Prefer long inventory ids (5+); allow 4+ when path has generation slug too.
      if (parts.length >= 5) {
        return true;
      }

      return last.length >= 5;
    }

    if (!/^\d{3,}$/.test(last)) {
      return false;
    }

    return AUTO_PATH_HINT_PATTERN.test(pathname) || dealerBrandPathRegex().test(pathname);
  } catch {
    return false;
  }
}

/**
 * Brand/model/generation filter pages under /used|/new|/sale|/stock.
 * Same SPA template for volvo/xc70, peugeot/408, opel/corsa — forms are on offer cards, not here.
 */
export function isStockListingUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '') || '/';
    const parts = pathSegments(path);

    if (!STOCK_CATALOG_ROOT.test(path)) {
      return false;
    }

    if (isOfferCardUrl(url)) {
      return false;
    }

    // /used, /used/volvo, /used/volvo/xc70, /used/peugeot/408, /used/volvo/xc70/ii-2007-2013
    return parts.length >= 1 && parts.length <= 4;
  } catch {
    return false;
  }
}

/** /used/volvo or /used/volvo/xc70 — brand/model filters (not bare /used catalog root). */
export function isBrandModelListingUrl(url: string): boolean {
  try {
    if (!isStockListingUrl(url)) {
      return false;
    }

    return pathSegments(new URL(url).pathname).length >= 2;
  } catch {
    return false;
  }
}

/** Vehicle detail / offer page where lead CTAs + modals usually live. */
export function isModelCardUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;

    // Under stock catalogs only numeric offer ids are real cards.
    if (STOCK_CATALOG_ROOT.test(pathname)) {
      return isOfferCardUrl(url);
    }

    if (isOfferCardUrl(url)) {
      return true;
    }

    // Non-stock model pages (some dealers host forms without an id segment).
    return MODEL_CARD_PATH_PATTERN.test(pathname);
  } catch {
    return false;
  }
}

/** Brand section index / stock filter: useful to discover cards, forms live on offer pages. */
export function isBrandListingUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '') || '/';

    if (isModelCardUrl(url)) {
      return false;
    }

    if (isStockListingUrl(url)) {
      return true;
    }

    return /\/(?:auto|cars|catalog|stock|models?|coche|avtomobili|avto|used|new|sale)\/[a-z0-9_-]+$/i.test(path)
      || /^\/(?:kia|hyundai|geely|chery|haval|omoda|jaecoo|exeed|changan|lada|toyota|bmw|audi|mazda|renault|nissan|volkswagen|vw|skoda|belgee|moskvich|volvo|ford|opel|peugeot)\/?$/i.test(path);
  } catch {
    return false;
  }
}

export function scoreLink(url: string, baseUrl: string): number {
  let score = 0;
  let pathname = '/';

  try {
    pathname = new URL(url).pathname;
  } catch {
    return -100;
  }

  if (normalizePageUrl(url) === normalizePageUrl(baseUrl)) {
    score += URL_SCORE_HOMEPAGE;
  }

  if (isLowValueUrl(url)) {
    score += URL_SCORE_LOW_VALUE;
  }

  if (CONTACT_PATH_PATTERN.test(url)) {
    score += URL_SCORE_CONTACT_PAGE;
  }

  if (OFFER_PATH_PATTERN.test(url)) {
    score += URL_SCORE_OFFER_PAGE;
  }

  if (AUTO_PATH_HINT_PATTERN.test(pathname)) {
    score += URL_SCORE_CATALOG_HINT;
  }

  // Offer cards host lead modals; stock filter pages only help discover those cards.
  if (isModelCardUrl(url)) {
    score += URL_SCORE_MODEL_CARD;
  } else if (isStockListingUrl(url)) {
    // One listing is enough to harvest card links — do not outrank real offers.
    score += Math.max(8, URL_SCORE_BRAND_LISTING - 6);
  } else if (isBrandListingUrl(url)) {
    score += URL_SCORE_BRAND_LISTING;
  } else if (isDealerBrandUrl(url)) {
    score += URL_SCORE_DEALER_BRAND;
  }

  const depth = pathname.split('/').filter(Boolean).length;
  // Prefer shallow pages, but don't punish model cards (depth ~3).
  if (!isModelCardUrl(url)) {
    score -= Math.min(depth, URL_SCORE_DEPTH_PENALTY_MAX);
  }

  return score;
}

export function calculateConfidence(parts: {
  hasPhone: boolean;
  hasSubmit: boolean;
  hasName: boolean;
  hasCheckbox: boolean;
  hasEmail?: boolean;
  hasTextarea?: boolean;
  isAuthForm?: boolean;
}): number {
  if (!parts.hasPhone || !parts.hasSubmit) {
    return 0;
  }

  let confidence = 70;

  if (parts.hasName) {
    confidence += 15;
  }

  if (parts.hasCheckbox) {
    confidence += 15;
  }

  if (parts.hasEmail) {
    confidence += 10;
  }

  if (parts.hasTextarea) {
    confidence += 5;
  }

  if (parts.isAuthForm) {
    confidence -= 100;
  }

  return Math.min(Math.max(confidence, 0), 100);
}
