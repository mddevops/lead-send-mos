import pino from 'pino';
import { claimNextTask, fetchRuntimeConfig, notifyTaskCompleted, notifyTaskFailed, notifyTaskStarted } from './services/laravelApi';
import { config } from './config';
import { applyRuntimeOverlay, runtimeConfig } from './runtimeConfig';
import { verifyCaptchaSolverConnection } from './utils/captchaSolver';
import { discoverYandexAds } from './tasks/discoverYandexAds';
import { manualMappingSession } from './tasks/manualMapping';
import { scanForm } from './tasks/scanForm';
import { submitLead } from './tasks/submitLead';

const logger = pino({ name: 'bot-worker' });

type WorkerTaskType = 'scan_form' | 'submit_lead' | 'manual_mapping_session' | 'discover_yandex_ads';

type WorkerPayload = {
  taskId: number;
  type: WorkerTaskType;
  payload: Record<string, unknown>;
};

async function syncRuntimeConfigFromLaravel(): Promise<void> {
  const remote = await fetchRuntimeConfig();
  if (!remote) {
    return;
  }

  applyRuntimeOverlay({
    BOT_CONCURRENCY: remote.bot_concurrency,
    CAPTCHA_SOLVER_ENABLED: remote.captcha_solver_enabled,
    CAPTCHA_SOLVER_API_KEY: remote.captcha_solver_api_key,
    CAPTCHA_SOLVER_PROVIDER: remote.captcha_solver_provider,
  });

  logger.info(
    {
      concurrency: runtimeConfig.BOT_CONCURRENCY,
      captcha_enabled: runtimeConfig.CAPTCHA_SOLVER_ENABLED,
      captcha_provider: runtimeConfig.CAPTCHA_SOLVER_PROVIDER,
      captcha_key_set: runtimeConfig.CAPTCHA_SOLVER_API_KEY.trim().length > 0,
    },
    'Runtime config synced from Laravel',
  );
}

async function runTask(task: WorkerPayload, options?: { skipStartNotification?: boolean }): Promise<void> {
  if (!config.BOT_API_TOKEN) {
    throw new Error('BOT_API_TOKEN is required to execute tasks');
  }

  if (!options?.skipStartNotification) {
    await notifyTaskStarted(task.taskId);
  }

  const startedAt = Date.now();

  try {
    if (task.type === 'scan_form') {
      await scanForm(task.payload as Parameters<typeof scanForm>[0]);
    } else if (task.type === 'submit_lead') {
      await submitLead(task.payload as Parameters<typeof submitLead>[0]);
    } else if (task.type === 'manual_mapping_session') {
      await manualMappingSession(task.payload as Parameters<typeof manualMappingSession>[0]);
    } else if (task.type === 'discover_yandex_ads') {
      await discoverYandexAds(task.payload as Parameters<typeof discoverYandexAds>[0]);
    } else {
      throw new Error(`Unsupported task type: ${String(task.type)}`);
    }

    await notifyTaskCompleted(task.taskId, {
      duration_ms: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    logger.error({ err: error }, 'Task execution failed');

    await notifyTaskFailed(task.taskId, {
      error_message: message,
      duration_ms: Date.now() - startedAt,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPollingWorker(): Promise<void> {
  const workerId = process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? 'worker';
  const active = new Set<Promise<void>>();
  let discoverActive = 0;
  let idleCycles = 0;
  let lastConfigSyncAt = 0;

  logger.info(
    { concurrency: runtimeConfig.BOT_CONCURRENCY, poll_interval_ms: config.BOT_POLL_INTERVAL_MS },
    'Starting polling worker loop',
  );

  while (true) {
    try {
      if (Date.now() - lastConfigSyncAt >= 60_000) {
        await syncRuntimeConfigFromLaravel();
        lastConfigSyncAt = Date.now();
      }

      const concurrency = runtimeConfig.BOT_CONCURRENCY;

      while (active.size < concurrency) {
        const excludeTypes = discoverActive > 0 ? ['discover_yandex_ads'] : [];
        const task = await claimNextTask(workerId, { excludeTypes });

        if (!task) {
          break;
        }

        idleCycles = 0;
        logger.info(
          {
            taskId: task.taskId,
            type: task.type,
            active: active.size + 1,
            concurrency,
          },
          'Claimed task',
        );

        if (task.type === 'discover_yandex_ads') {
          discoverActive += 1;
        }

        let taskPromise!: Promise<void>;
        taskPromise = runTask(task, { skipStartNotification: true })
          .catch((error) => {
            logger.error({ err: error, taskId: task.taskId }, 'Unhandled task error');
          })
          .finally(() => {
            if (task.type === 'discover_yandex_ads') {
              discoverActive = Math.max(0, discoverActive - 1);
            }
            active.delete(taskPromise);
          });

        active.add(taskPromise);
      }

      if (active.size === 0) {
        idleCycles += 1;
        if (idleCycles % 20 === 0) {
          logger.info('No queued tasks found');
        }
        await sleep(config.BOT_POLL_INTERVAL_MS);
        continue;
      }

      await Promise.race([
        Promise.race([...active]),
        sleep(config.BOT_POLL_INTERVAL_MS),
      ]);
    } catch (error) {
      logger.error({ err: error }, 'Polling loop error');
      await sleep(config.BOT_POLL_INTERVAL_MS);
    }
  }
}

async function bootstrap(): Promise<void> {
  await syncRuntimeConfigFromLaravel();

  logger.info(
    {
      api: config.BOT_API_BASE_URL,
      headless: config.BOT_HEADLESS,
      browser: config.BOT_BROWSER,
      concurrency: runtimeConfig.BOT_CONCURRENCY,
      poll_interval_ms: config.BOT_POLL_INTERVAL_MS,
      captcha_solver: runtimeConfig.CAPTCHA_SOLVER_ENABLED ? runtimeConfig.CAPTCHA_SOLVER_PROVIDER : 'disabled',
    },
    'bot-worker started',
  );

  if (runtimeConfig.CAPTCHA_SOLVER_ENABLED) {
    try {
      const status = await verifyCaptchaSolverConnection();
      logger.info(
        { provider: status.provider, balance: status.balance },
        'Captcha solver connected',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ message }, 'Captcha solver is enabled but connection failed');
    }
  }

  if (process.env.WORKER_TASK_JSON) {
    const task = JSON.parse(process.env.WORKER_TASK_JSON) as WorkerPayload;
    await runTask(task);
    return;
  }

  await runPollingWorker();
}

bootstrap().catch((error: unknown) => {
  logger.error({ err: error }, 'Fatal worker error');
  logger.error(
  'Проверьте: 1) Laravel запущен (php artisan serve --port=8081), 2) bot-worker/.env с BOT_API_BASE_URL и BOT_API_TOKEN',
  );
  process.exit(1);
});
