import { BrowserProxy } from '../playwright/browserTypes';

export type ProxyConfig = {
  id: number;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  changeIpUrl?: string | null;
};

export function buildProxyServer(proxy?: ProxyConfig | null): BrowserProxy | undefined {
  if (!proxy) {
    return undefined;
  }

  return {
    server: `http://${proxy.host}:${proxy.port}`,
    username: proxy.username ?? undefined,
    password: proxy.password ?? undefined,
  };
}

export async function rotateProxyIfNeeded(params: {
  proxy?: ProxyConfig | null;
  rotateBeforeEachSite?: boolean;
  timeoutMs?: number;
}): Promise<void> {
  if (!params.proxy || !params.rotateBeforeEachSite || !params.proxy.changeIpUrl) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 10000);

  try {
    await fetch(params.proxy.changeIpUrl, {
      method: 'GET',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkIpBeforeRunIfNeeded(params: {
  enabled?: boolean;
  timeoutMs?: number;
}): Promise<void> {
  if (!params.enabled) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 10000);

  try {
    await fetch('https://api.ipify.org?format=json', {
      method: 'GET',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
