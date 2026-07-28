import { existsSync } from 'node:fs';
import path from 'node:path';
import type { FormDetectionResult } from './formDetector.browser';

type CollectFormsInDocument = () => FormDetectionResult;

let cachedCollector: CollectFormsInDocument | null = null;

/**
 * Playwright serializes functions passed to page.evaluate into the browser.
 * tsx injects a `__name` helper that does not exist in the page context.
 * Always load the tsc-compiled detector for evaluate calls.
 */
export function getCollectFormsInDocument(): CollectFormsInDocument {
  if (cachedCollector) {
    return cachedCollector;
  }

  const here = __dirname;
  const candidates = [
    path.join(here, 'formDetector.browser.js'),
    path.join(here, '..', '..', 'dist', 'utils', 'formDetector.browser.js'),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require(candidate) as { collectFormsInDocument?: CollectFormsInDocument };

    if (typeof loaded.collectFormsInDocument === 'function') {
      cachedCollector = loaded.collectFormsInDocument;
      return cachedCollector;
    }
  }

  throw new Error(
    'Compiled formDetector.browser.js not found. Run `npm run build` in bot-worker before starting the worker.',
  );
}
