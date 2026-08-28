import { Page } from 'playwright';
import {
  ERROR_TEXT_PATTERN,
  SUCCESS_TEXT_PATTERN,
} from './formDetectionConstants';

export type CapturedNetworkResponse = {
  url: string;
  status: number;
  method: string;
  body: string;
  score: number;
};

const NOISE_URL_PATTERN =
  /mc\.yandex|metrika|google-analytics|googletagmanager|facebook\.com\/tr|vk\.com\/rtrg|smartcaptcha|captcha\.yandex|yandexcloud\.net\/check|showcaptcha|checkcaptcha|api-maps\.yandex|log\.api-maps|doubleclick|yandex\.ru\/clck|tildaapi\.com\/event|stat\.tilda|forms\.tildaapi\.com\/procces\/captcha/i;

const FORM_POST_URL_PATTERN =
  /form|lead|callback|request|submit|crm|bitrix|amo|tilda|send|order|claim|application|feedback|contact|webhook|api\//i;

const STATIC_ASSET_PATTERN = /\.(?:js|css|woff2?|ttf|eot|svg|png|jpe?g|gif|webp|ico|map)(?:\?|$)/i;

export function isNoiseNetworkUrl(url: string): boolean {
  return NOISE_URL_PATTERN.test(url);
}

export function scoreSubmitNetworkResponse(
  url: string,
  method: string,
  contentType: string | null,
): number {
  const upperMethod = method.toUpperCase();
  if (upperMethod !== 'POST' && upperMethod !== 'PUT' && upperMethod !== 'PATCH') {
    return 0;
  }

  if (isNoiseNetworkUrl(url)) {
    return 0;
  }

  if (STATIC_ASSET_PATTERN.test(url)) {
    return 1;
  }

  let score = 20;

  if (FORM_POST_URL_PATTERN.test(url)) {
    score += 80;
  }

  if (contentType?.includes('application/json')) {
    score += 40;
  } else if (contentType?.includes('text/html')) {
    score += 15;
  } else if (contentType?.includes('text/plain')) {
    score += 25;
  }

  if (upperMethod === 'POST') {
    score += 10;
  }

  return score;
}

export function createSubmitResponseCollector(siteHostname: string): {
  onResponse: (response: {
    url: () => string;
    status: () => number;
    request: () => { method: () => string; url: () => string };
    headers: () => Record<string, string>;
    text: () => Promise<string>;
  }) => Promise<void>;
  getBestNetworkResponse: () => CapturedNetworkResponse | null;
  getNetworkOkStatuses: () => number[];
} {
  let best: CapturedNetworkResponse | null = null;
  const networkOkStatuses: number[] = [];

  const onResponse = async (response: {
    url: () => string;
    status: () => number;
    request: () => { method: () => string; url: () => string };
    headers: () => Record<string, string>;
    text: () => Promise<string>;
  }): Promise<void> => {
    const request = response.request();
    const method = request.method().toUpperCase();
    const status = response.status();
    const responseHref = response.url();

    if (
      (method === 'POST' || method === 'PUT' || method === 'PATCH')
      && (status === 200 || status === 201 || status === 204)
      && !isNoiseNetworkUrl(responseHref)
    ) {
      networkOkStatuses.push(status);
    }

    if (!request.url().includes(siteHostname) && !responseHref.includes(siteHostname)) {
      return;
    }

    if (/mc\.yandex|google-analytics|googletagmanager|facebook\.com\/tr|vk\.com\/rtrg|api-maps\.yandex|log\.api-maps/i.test(responseHref)) {
      return;
    }

    const contentType = response.headers()['content-type'] ?? null;
    const score = scoreSubmitNetworkResponse(responseHref, method, contentType);
    if (score <= 0) {
      return;
    }

    let body = '';
    try {
      body = (await response.text()).slice(0, 4000);
    } catch {
      body = '';
    }

    const candidate: CapturedNetworkResponse = {
      url: responseHref,
      status,
      method,
      body,
      score,
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  };

  return {
    onResponse,
    getBestNetworkResponse: () => best,
    getNetworkOkStatuses: () => networkOkStatuses,
  };
}

export async function extractVisibleSubmitFeedback(
  page: Page,
  formScopeSelector?: string | null,
): Promise<{ success: string | null; error: string | null }> {
  return page.evaluate((scopeSelector) => {
    const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim();

    const roots: Element[] = [];
    if (scopeSelector) {
      const scoped = document.querySelector(scopeSelector);
      if (scoped) {
        roots.push(scoped);
      }
    }
    roots.push(document.body);

    const successPattern =
      /спасибо(?:\s+за\s+заявк|\s+за\s+обращени)?|заявка\s+(?:успешно\s+)?отправлена|заявка\s+принята|мы\s+свяжемся|мы\s+перезвоним|перезвоним(?:\s+вам)?|успешно(?:\s+отправлено)?|отправлено|принято|thank\s+you|request\s+sent|submitted\s+successfully/i;
    const errorPattern =
      /ошибк|не\s+удалось|неверн|укажите|заполните|обязательн|invalid|error|failed|попробуйте\s+ещё|попробуйте\s+еще/i;

    const selectors = [
      '[role="alert"]',
      '[role="status"]',
      '.alert',
      '.toast',
      '.notification',
      '.form-message',
      '.form__message',
      '.error',
      '.success',
      '.modal.show',
      '.modal.is-open',
      '.modal.open',
      '.t-popup_show',
      '.popup.open',
      '[class*="success"]',
      '[class*="error"]',
      '[class*="message"]',
    ];

    let success: string | null = null;
    let error: string | null = null;

    for (const root of roots) {
      for (const selector of selectors) {
        const nodes = root.querySelectorAll(selector);
        for (const node of Array.from(nodes)) {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          const visible =
            style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number(style.opacity) !== 0
            && rect.width >= 4
            && rect.height >= 4;
          if (!visible) {
            continue;
          }

          const text = normalize(node.textContent || '');
          if (text.length < 3 || text.length > 500) {
            continue;
          }

          if (!success && successPattern.test(text)) {
            success = text;
          }
          if (!error && errorPattern.test(text)) {
            error = text;
          }
        }
      }
    }

    return { success, error };
  }, formScopeSelector ?? null);
}

export function buildSubmitResponseText(params: {
  visibleSuccess?: string | null;
  visibleError?: string | null;
  network?: CapturedNetworkResponse | null;
  pageSnippet?: string | null;
}): string | null {
  const lines: string[] = [];

  if (params.visibleSuccess) {
    lines.push(`[visible_success] ${params.visibleSuccess}`);
  }
  if (params.visibleError) {
    lines.push(`[visible_error] ${params.visibleError}`);
  }

  if (params.network) {
    const body = params.network.body.trim();
    const preview = body !== '' ? body.slice(0, 1200) : '(empty body)';
    lines.push(
      `[${params.network.method} ${params.network.status}] ${params.network.url}`,
      preview,
    );
  }

  if (params.pageSnippet) {
    lines.push(`[page_text] ${params.pageSnippet.slice(0, 800)}`);
  }

  if (lines.length === 0) {
    return null;
  }

  return lines.join('\n').slice(0, 5000);
}

export function pickSubmitResponseUrl(
  network?: CapturedNetworkResponse | null,
  pageUrl?: string | null,
): string | null {
  if (network?.url) {
    return network.url;
  }

  return pageUrl ?? null;
}

export { SUCCESS_TEXT_PATTERN, ERROR_TEXT_PATTERN };
