import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import type { BrowserContext } from 'playwright';

const logger = pino({ name: 'yandex-cookies' });

/** Directory for Yandex session cookies after captcha solve. */
export function yandexCookiesDir(): string {
  const dir = path.resolve(__dirname, '../../storage/yandex-cookies');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * One jar per proxy (Yandex ties trust to IP). Without proxy → direct.json.
 */
export function yandexCookieStatePath(proxyId?: number | null): string {
  const key = proxyId && proxyId > 0 ? `proxy-${proxyId}` : 'direct';
  return path.join(yandexCookiesDir(), `${key}.json`);
}

export function loadYandexStorageState(proxyId?: number | null): string | undefined {
  const filePath = yandexCookieStatePath(proxyId);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { cookies?: unknown[] };
    const count = Array.isArray(parsed.cookies) ? parsed.cookies.length : 0;
    logger.info({ filePath, cookies: count }, 'Loaded Yandex cookie storageState');
    return filePath;
  } catch (error) {
    logger.warn({ filePath, err: error }, 'Broken Yandex cookie file — starting clean');
    return undefined;
  }
}

export async function saveYandexCookies(
  context: BrowserContext,
  proxyId?: number | null,
  reason = 'session',
): Promise<void> {
  const filePath = yandexCookieStatePath(proxyId);

  try {
    await context.storageState({ path: filePath });
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { cookies?: Array<{ domain?: string }> };
    const cookies = Array.isArray(parsed.cookies) ? parsed.cookies : [];
    const yandexRelated = cookies.filter((c) =>
      /yandex\.|ya\.ru|yandex\.ru|yabs\.yandex/i.test(String(c.domain || '')),
    ).length;

    logger.info(
      { filePath, reason, cookies: cookies.length, yandexRelated },
      'Saved Yandex cookies after captcha / session',
    );
  } catch (error) {
    logger.warn({ filePath, err: error, reason }, 'Failed to save Yandex cookies');
  }
}
