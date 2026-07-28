import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const laravelEnvPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(laravelEnvPath)) {
  dotenv.config({ path: laravelEnvPath, override: false });
}

if (process.env.APP_URL && ! process.env.BOT_API_BASE_URL) {
  process.env.BOT_API_BASE_URL = `${process.env.APP_URL.replace(/\/$/, '')}/api`;
}

const envSchema = z.object({
  BOT_API_BASE_URL: z.string().default('http://127.0.0.1:8000/api'),
  BOT_API_TOKEN: z.string().min(1, 'BOT_API_TOKEN is required'),
  BOT_DEFAULT_DISK: z.string().default('local'),
  BOT_HEADLESS: z
    .string()
    .optional()
    .transform((v) => (v ?? 'true').toLowerCase() === 'true'),
  BOT_LOCALE: z.string().default('ru-RU'),
  BOT_TIMEZONE: z.string().default('Europe/Moscow'),
  BOT_VIEWPORT_WIDTH: z
    .string()
    .optional()
    .transform((v) => Number(v ?? '1280')),
  BOT_VIEWPORT_HEIGHT: z
    .string()
    .optional()
    .transform((v) => Number(v ?? '720')),
  BOT_POLL_INTERVAL_MS: z
    .string()
    .optional()
    .transform((v) => Number(v ?? '3000')),
  /** How many browser tasks to run in parallel (scan/submit). Discover stays 1-at-a-time. */
  BOT_CONCURRENCY: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number(v ?? '1');
      if (!Number.isFinite(n)) {
        return 1;
      }

      return Math.max(1, Math.min(8, Math.floor(n)));
    }),
  BOT_SCAN_PAGE_WAIT_MS: z
    .string()
    .optional()
    .transform((v) => Number(v ?? '4000')),
  BOT_DEBUG_PAUSE_MS: z
    .string()
    .optional()
    .transform((v) => Number(v ?? '0')),
  BOT_SLOW_MO: z
    .string()
    .optional()
    .transform((v) => Number(v ?? '0')),
  BOT_USE_INSTALLED_CHROME: z
    .string()
    .optional()
    .transform((v) => (v ?? 'false').toLowerCase() === 'true'),
  /** chromium = Playwright Chrome; camoufox = Camoufox anti-detect Firefox */
  BOT_BROWSER: z.enum(['chromium', 'camoufox']).optional().default('chromium'),
  CAPTCHA_SOLVER_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v ?? 'false').toLowerCase() === 'true'),
  CAPTCHA_SOLVER_API_KEY: z.string().optional().default(''),
  CAPTCHA_SOLVER_PROVIDER: z.enum(['2captcha', 'rucaptcha']).optional().default('rucaptcha'),
});

export const config = envSchema.parse(process.env);
