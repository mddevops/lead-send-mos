import axios from 'axios';
import pino from 'pino';
import { runtimeConfig as config } from '../runtimeConfig';

const logger = pino({ name: 'captcha-solver' });

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_ATTEMPTS = 36;

export type CaptchaSolverProvider = '2captcha' | 'rucaptcha';

function solverBaseUrl(): string {
  return config.CAPTCHA_SOLVER_PROVIDER === 'rucaptcha'
    ? 'https://rucaptcha.com'
    : 'https://2captcha.com';
}

function apiKey(): string {
  return config.CAPTCHA_SOLVER_API_KEY.trim();
}

/** Masked key for logs/errors — never full secret. */
export function maskedCaptchaApiKey(): string {
  const key = apiKey();
  if (!key) return '(empty)';
  if (key.length <= 8) return `${key.slice(0, 2)}…(len=${key.length})`;
  return `${key.slice(0, 4)}…${key.slice(-4)} (len=${key.length})`;
}

function withKeyHint(message: string): string {
  if (!/ERROR_ZERO_BALANCE|ERROR_KEY_DOES_NOT_EXIST|ERROR_WRONG_USER_KEY|ERROR_IP_NOT_ALLOWED/i.test(message)) {
    return message;
  }
  return `${message} [provider=${config.CAPTCHA_SOLVER_PROVIDER}; captcha_key=${maskedCaptchaApiKey()}]`;
}

export function isSolverConfigured(): boolean {
  return config.CAPTCHA_SOLVER_ENABLED && apiKey().length > 0;
}

type SolverSubmitResponse = {
  status: number;
  request: string;
};

type SolverResultResponse = {
  status: number;
  request: string;
};

export async function getCaptchaSolverBalance(): Promise<number> {
  const response = await axios.get<SolverResultResponse>(`${solverBaseUrl()}/res.php`, {
    params: {
      key: apiKey(),
      action: 'getbalance',
      json: 1,
    },
    timeout: 15000,
  });

  if (response.data.status !== 1) {
    throw new Error(withKeyHint(`Не удалось получить баланс ${config.CAPTCHA_SOLVER_PROVIDER}: ${response.data.request}`));
  }

  return Number.parseFloat(response.data.request);
}

async function pollTaskResult(taskId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const resultResponse = await axios.get<SolverResultResponse>(`${solverBaseUrl()}/res.php`, {
      params: {
        key: apiKey(),
        action: 'get',
        id: taskId,
        json: 1,
      },
      timeout: 30000,
    });

    if (resultResponse.data.status === 1) {
      return resultResponse.data.request.trim();
    }

    if (resultResponse.data.request !== 'CAPCHA_NOT_READY') {
      throw new Error(withKeyHint(`Сервис капчи вернул ошибку: ${resultResponse.data.request}`));
    }

    logger.info({ taskId, attempt: attempt + 1 }, 'Waiting for captcha solution');
  }

  throw new Error('Сервис капчи не успел решить задачу за отведённое время.');
}

/**
 * Обычная картинка / «текст с картинки» (method=base64).
 * @see https://rucaptcha.com/api-rucaptcha
 */
export async function solveCaptchaImageBase64(imageBase64: string): Promise<string> {
  if (!isSolverConfigured()) {
    throw new Error(
      'Для «текст с картинки» включите CAPTCHA_SOLVER_ENABLED=true и укажите CAPTCHA_SOLVER_API_KEY (ruCaptcha).',
    );
  }

  const submitResponse = await axios.post<SolverSubmitResponse>(
    `${solverBaseUrl()}/in.php`,
    new URLSearchParams({
      key: apiKey(),
      method: 'base64',
      body: imageBase64,
      json: '1',
      lang: 'ru',
      numeric: '0',
      regsense: '0',
      min_len: '2',
      max_len: '120',
      textinstructions: 'Введите текст с картинки. Строчные или прописные буквы.',
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    },
  );

  if (submitResponse.data.status !== 1) {
    throw new Error(withKeyHint(`Сервис капчи отклонил задачу: ${submitResponse.data.request}`));
  }

  const taskId = submitResponse.data.request;

  logger.info(
    { provider: config.CAPTCHA_SOLVER_PROVIDER, taskId, method: 'base64' },
    'Captcha image sent to solver',
  );

  const solution = await pollTaskResult(taskId);

  logger.info(
    { provider: config.CAPTCHA_SOLVER_PROVIDER, taskId, solution },
    'Captcha image solution received',
  );

  return solution;
}

/**
 * Yandex SmartCaptcha token method (method=yandex).
 * Возвращает готовый smart-token без кликов по UI.
 * @see https://rucaptcha.com/api-rucaptcha#yandex
 */
export async function solveYandexSmartCaptchaToken(params: {
  sitekey: string;
  pageurl: string;
  userAgent?: string;
}): Promise<string> {
  if (!isSolverConfigured()) {
    throw new Error(
      'Для Yandex SmartCaptcha включите CAPTCHA_SOLVER_ENABLED=true и укажите CAPTCHA_SOLVER_API_KEY (ruCaptcha).',
    );
  }

  const body = new URLSearchParams({
    key: apiKey(),
    method: 'yandex',
    sitekey: params.sitekey,
    pageurl: params.pageurl,
    json: '1',
  });

  if (params.userAgent) {
    body.set('userAgent', params.userAgent);
  }

  const submitResponse = await axios.post<SolverSubmitResponse>(
    `${solverBaseUrl()}/in.php`,
    body.toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    },
  );

  if (submitResponse.data.status !== 1) {
    throw new Error(withKeyHint(`Сервис капчи отклонил Yandex задачу: ${submitResponse.data.request}`));
  }

  const taskId = submitResponse.data.request;

  logger.info(
    { provider: config.CAPTCHA_SOLVER_PROVIDER, taskId, method: 'yandex', sitekey: params.sitekey },
    'Yandex SmartCaptcha task sent to solver',
  );

  const token = await pollTaskResult(taskId);

  logger.info(
    { provider: config.CAPTCHA_SOLVER_PROVIDER, taskId, tokenLength: token.length },
    'Yandex SmartCaptcha token received',
  );

  return token;
}

export type CaptchaCoordinate = { x: number; y: number };

/**
 * Yandex SmartCaptcha silhouettes / icons — click objects in instruction order.
 * Uses CoordinatesTask (API v2) with imgType=smart_captcha.
 * @see https://rucaptcha.com/api-docs/yandex-smart-captcha
 */
export async function solveYandexSmartCaptchaCoordinates(params: {
  bodyBase64: string;
  instructionsBase64: string;
  comment?: string;
}): Promise<CaptchaCoordinate[]> {
  if (!isSolverConfigured()) {
    throw new Error(
      'Для иконок SmartCaptcha включите CAPTCHA_SOLVER_ENABLED=true и укажите CAPTCHA_SOLVER_API_KEY (ruCaptcha).',
    );
  }

  const apiHost = config.CAPTCHA_SOLVER_PROVIDER === 'rucaptcha'
    ? 'https://api.rucaptcha.com'
    : 'https://api.2captcha.com';

  const stripDataUri = (value: string): string =>
    value.includes(',') ? value.split(',').pop() || value : value;

  const createResponse = await axios.post<{
    errorId: number;
    errorDescription?: string;
    taskId?: number;
  }>(
    `${apiHost}/createTask`,
    {
      clientKey: apiKey(),
      task: {
        type: 'CoordinatesTask',
        body: stripDataUri(params.bodyBase64),
        imgType: 'smart_captcha',
        imgInstructions: stripDataUri(params.instructionsBase64),
        comment: params.comment
          || 'Select objects in the order shown in the instruction strip. Click icons from left to right as indicated.',
      },
    },
    { timeout: 30000 },
  );

  if (createResponse.data.errorId !== 0 || !createResponse.data.taskId) {
    // Fallback: API v1 coordinatescaptcha
    return solveCoordinatesViaApiV1(params);
  }

  const taskId = String(createResponse.data.taskId);

  logger.info(
    { provider: config.CAPTCHA_SOLVER_PROVIDER, taskId, method: 'CoordinatesTask', imgType: 'smart_captcha' },
    'Yandex icons captcha sent to solver',
  );

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const resultResponse = await axios.post<{
      errorId: number;
      status?: string;
      errorDescription?: string;
      solution?: { coordinates?: Array<{ x: number; y: number }> };
    }>(
      `${apiHost}/getTaskResult`,
      {
        clientKey: apiKey(),
        taskId: Number(taskId),
      },
      { timeout: 30000 },
    );

    if (resultResponse.data.errorId !== 0) {
      throw new Error(
        `Сервис капчи вернул ошибку координат: ${resultResponse.data.errorDescription || resultResponse.data.errorId}`,
      );
    }

    if (resultResponse.data.status === 'ready') {
      const coordinates = resultResponse.data.solution?.coordinates || [];
      if (coordinates.length === 0) {
        throw new Error('Сервис капчи вернул пустой список координат');
      }

      logger.info(
        { provider: config.CAPTCHA_SOLVER_PROVIDER, taskId, clicks: coordinates.length },
        'Yandex icons captcha coordinates received',
      );

      return coordinates.map((point) => ({
        x: Number(point.x),
        y: Number(point.y),
      }));
    }

    logger.info({ taskId, attempt: attempt + 1 }, 'Waiting for icons captcha solution');
  }

  throw new Error('Сервис капчи не успел решить иконки SmartCaptcha за отведённое время.');
}

async function solveCoordinatesViaApiV1(params: {
  bodyBase64: string;
  instructionsBase64: string;
  comment?: string;
}): Promise<CaptchaCoordinate[]> {
  const stripDataUri = (value: string): string =>
    value.includes(',') ? value.split(',').pop() || value : value;

  const submitResponse = await axios.post<SolverSubmitResponse>(
    `${solverBaseUrl()}/in.php`,
    new URLSearchParams({
      key: apiKey(),
      method: 'base64',
      coordinatescaptcha: '1',
      body: stripDataUri(params.bodyBase64),
      imginstructions: stripDataUri(params.instructionsBase64),
      textinstructions: params.comment
        || 'Кликните по объектам в том же порядке, что на полоске внизу (слева направо).',
      json: '1',
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    },
  );

  if (submitResponse.data.status !== 1) {
    throw new Error(withKeyHint(`Сервис капчи отклонил coordinates задачу: ${submitResponse.data.request}`));
  }

  const taskId = submitResponse.data.request;

  logger.info(
    { provider: config.CAPTCHA_SOLVER_PROVIDER, taskId, method: 'coordinatescaptcha_v1' },
    'Yandex icons captcha sent via API v1',
  );

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const resultResponse = await axios.get<{
      status: number;
      request: string | Array<{ x: string | number; y: string | number }>;
    }>(`${solverBaseUrl()}/res.php`, {
      params: {
        key: apiKey(),
        action: 'get',
        id: taskId,
        json: 1,
      },
      timeout: 30000,
    });

    if (resultResponse.data.status === 1) {
      const raw = resultResponse.data.request;
      const coordinates = Array.isArray(raw)
        ? raw.map((point) => ({ x: Number(point.x), y: Number(point.y) }))
        : [];

      if (coordinates.length === 0) {
        throw new Error('Сервис капчи вернул пустой список координат (v1)');
      }

      logger.info(
        { provider: config.CAPTCHA_SOLVER_PROVIDER, taskId, clicks: coordinates.length },
        'Yandex icons captcha coordinates received (v1)',
      );

      return coordinates;
    }

    if (resultResponse.data.request !== 'CAPCHA_NOT_READY') {
      throw new Error(withKeyHint(`Сервис капчи вернул ошибку: ${String(resultResponse.data.request)}`));
    }

    logger.info({ taskId, attempt: attempt + 1 }, 'Waiting for icons captcha solution (v1)');
  }

  throw new Error('Сервис капчи не успел решить иконки SmartCaptcha (v1).');
}

export async function verifyCaptchaSolverConnection(): Promise<{ balance: number; provider: CaptchaSolverProvider }> {
  if (!isSolverConfigured()) {
    throw new Error('CAPTCHA_SOLVER_ENABLED=true и CAPTCHA_SOLVER_API_KEY обязательны.');
  }

  const balance = await getCaptchaSolverBalance();

  return {
    balance,
    provider: config.CAPTCHA_SOLVER_PROVIDER,
  };
}

export function captchaSolverAvailable(): boolean {
  return isSolverConfigured();
}
