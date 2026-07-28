import pino from 'pino';
import { Page, Response } from 'playwright';

const logger = pino({ name: 'navigate' });

export type NavigateOptions = {
  timeoutMs?: number;
  retries?: number;
};

/**
 * Reliable page open for SPA / slow / proxy sites.
 * Prefer commit → soft wait for DOM, instead of hard-failing on domcontentloaded.
 */
export async function navigateToUrl(
  page: Page,
  url: string,
  options?: NavigateOptions,
): Promise<Response | null> {
  const timeoutMs = options?.timeoutMs ?? 60000;
  const retries = options?.retries ?? 1;

  let lastError: unknown;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const startedAt = Date.now();

    try {
      logger.info({ url, attempt, timeoutMs }, 'Navigating');

      // commit = first response received; works even when document keeps scripts forever
      const response = await page.goto(url, {
        waitUntil: 'commit',
        timeout: timeoutMs,
      });

      await page.waitForLoadState('domcontentloaded', { timeout: Math.min(25000, timeoutMs) }).catch(() => {
        logger.warn({ url, attempt }, 'domcontentloaded not reached, continuing with commit');
      });

      await page.waitForLoadState('load', { timeout: 8000 }).catch(() => undefined);

      logger.info(
        {
          url: page.url(),
          status: response?.status() ?? null,
          elapsed_ms: Date.now() - startedAt,
          attempt,
        },
        'Navigation complete',
      );

      return response;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ url, attempt, message, elapsed_ms: Date.now() - startedAt }, 'Navigation attempt failed');

      if (attempt <= retries) {
        await page.waitForTimeout(1500);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Не удалось открыть ${url}`);
}
