/**
 * Browser / PC fingerprints + region geo for submit_lead.
 */

export type RegionPayload = {
  id?: number;
  name?: string;
} | null;

export type BrowserFingerprint = {
  profileId: string;
  label: string;
  userAgent: string;
  viewport: { width: number; height: number };
  locale: string;
  timezoneId: string;
  geolocation: { latitude: number; longitude: number; accuracy: number };
  acceptLanguage: string;
  colorScheme: 'light' | 'dark';
  platform: string;
};

type PcProfile = {
  id: string;
  label: string;
  userAgent: string;
  viewport: { width: number; height: number };
  acceptLanguage: string;
  colorScheme: 'light' | 'dark';
  platform: string;
};

type RegionMeta = {
  timezoneId: string;
  locale: string;
  geolocation: { latitude: number; longitude: number; accuracy: number };
};

const DEFAULT_REGION: RegionMeta = {
  timezoneId: 'Europe/Moscow',
  locale: 'ru-RU',
  geolocation: { latitude: 55.7558, longitude: 37.6173, accuracy: 80 },
};

/** Region name (from DB) → timezone + coords for browser context. */
const REGION_META: Record<string, RegionMeta> = {
  москва: {
    timezoneId: 'Europe/Moscow',
    locale: 'ru-RU',
    geolocation: { latitude: 55.7558, longitude: 37.6173, accuracy: 60 },
  },
  'санкт-петербург': {
    timezoneId: 'Europe/Moscow',
    locale: 'ru-RU',
    geolocation: { latitude: 59.9343, longitude: 30.3351, accuracy: 70 },
  },
  'ростов-на-дону': {
    timezoneId: 'Europe/Moscow',
    locale: 'ru-RU',
    geolocation: { latitude: 47.2357, longitude: 39.7015, accuracy: 90 },
  },
  краснодар: {
    timezoneId: 'Europe/Moscow',
    locale: 'ru-RU',
    geolocation: { latitude: 45.0355, longitude: 38.9753, accuracy: 90 },
  },
  'нижний новгород': {
    timezoneId: 'Europe/Moscow',
    locale: 'ru-RU',
    geolocation: { latitude: 56.2965, longitude: 43.9361, accuracy: 85 },
  },
  петрозаводск: {
    timezoneId: 'Europe/Moscow',
    locale: 'ru-RU',
    geolocation: { latitude: 61.7849, longitude: 34.3469, accuracy: 100 },
  },
  мурманск: {
    timezoneId: 'Europe/Moscow',
    locale: 'ru-RU',
    geolocation: { latitude: 68.9585, longitude: 33.0827, accuracy: 120 },
  },
};

/** Distinct “different PC” profiles — UA + viewport + Accept-Language. */
const PC_PROFILES: PcProfile[] = [
  {
    id: 'win10_chrome131_fhd',
    label: 'Win10 Chrome 131 1920x1080',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    acceptLanguage: 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    colorScheme: 'light',
    platform: 'Win32',
  },
  {
    id: 'win11_chrome130_laptop',
    label: 'Win11 Chrome 130 1366x768',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    acceptLanguage: 'ru-RU,ru;q=0.9,en;q=0.8',
    colorScheme: 'light',
    platform: 'Win32',
  },
  {
    id: 'win10_chrome128_hdplus',
    label: 'Win10 Chrome 128 1600x900',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1600, height: 900 },
    acceptLanguage: 'ru,ru-RU;q=0.9,en-US;q=0.5,en;q=0.3',
    colorScheme: 'light',
    platform: 'Win32',
  },
  {
    id: 'win11_edge131_fhd',
    label: 'Win11 Edge 131 1920x1080',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    viewport: { width: 1920, height: 1080 },
    acceptLanguage: 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
    colorScheme: 'light',
    platform: 'Win32',
  },
  {
    id: 'win10_chrome122_wxga',
    label: 'Win10 Chrome 122 1440x900',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    acceptLanguage: 'ru-RU,ru;q=0.9',
    colorScheme: 'light',
    platform: 'Win32',
  },
  {
    id: 'win11_chrome125_qhd',
    label: 'Win11 Chrome 125 2560x1440',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 2560, height: 1440 },
    acceptLanguage: 'ru-RU,ru;q=0.9,en-US;q=0.7,en;q=0.6',
    colorScheme: 'dark',
    platform: 'Win32',
  },
  {
    id: 'win10_chrome119_hd',
    label: 'Win10 Chrome 119 1280x720',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    acceptLanguage: 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    colorScheme: 'light',
    platform: 'Win32',
  },
  {
    id: 'win11_chrome131_uxga',
    label: 'Win11 Chrome 131 1680x1050',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1680, height: 1050 },
    acceptLanguage: 'ru-RU,ru;q=0.9,uk;q=0.4,en;q=0.3',
    colorScheme: 'light',
    platform: 'Win32',
  },
  {
    id: 'win10_yandex_fhd',
    label: 'Win10 YaBrowser 1920x1080',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 YaBrowser/24.1.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    acceptLanguage: 'ru-RU,ru;q=0.9,en;q=0.8',
    colorScheme: 'light',
    platform: 'Win32',
  },
  {
    id: 'win11_chrome126_sxga',
    label: 'Win11 Chrome 126 1280x1024',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 1024 },
    acceptLanguage: 'ru,en-US;q=0.9,en;q=0.8',
    colorScheme: 'light',
    platform: 'Win32',
  },
];

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

export function resolveRegionMeta(regionName?: string | null): RegionMeta {
  if (!regionName) {
    return DEFAULT_REGION;
  }

  const key = regionName.trim().toLowerCase();

  return REGION_META[key] ?? DEFAULT_REGION;
}

export function pickBrowserFingerprint(region?: RegionPayload): BrowserFingerprint {
  const profile = randomItem(PC_PROFILES);
  const regionMeta = resolveRegionMeta(region?.name);

  return {
    profileId: profile.id,
    label: profile.label,
    userAgent: profile.userAgent,
    viewport: profile.viewport,
    locale: regionMeta.locale,
    timezoneId: regionMeta.timezoneId,
    geolocation: regionMeta.geolocation,
    acceptLanguage: profile.acceptLanguage,
    colorScheme: profile.colorScheme,
    platform: profile.platform,
  };
}
