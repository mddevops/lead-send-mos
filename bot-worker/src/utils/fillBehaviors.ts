import { Locator } from 'playwright';
import { humanClickLocator } from './humanMouse';

export const FILL_BEHAVIOR_IDS = [
  'typo_backspace',
  'slow_careful',
  'fast_burst',
  'paste_instant',
  'chunk_pause',
  'select_all_retype',
  'hesitate_mid',
  'clear_retype',
  'overshoot_backspace',
  'two_speed',
] as const;

export type FillBehaviorId = (typeof FILL_BEHAVIOR_IDS)[number];

export function pickFillBehavior(): FillBehaviorId {
  return FILL_BEHAVIOR_IDS[Math.floor(Math.random() * FILL_BEHAVIOR_IDS.length)]!;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function pause(locator: Locator, minMs: number, maxMs: number): Promise<void> {
  await locator.page().waitForTimeout(randomInt(minMs, maxMs));
}

async function typeChars(locator: Locator, text: string, delayMin: number, delayMax: number): Promise<void> {
  if (text.length === 0) {
    return;
  }

  await locator.pressSequentially(text, { delay: randomInt(delayMin, delayMax) });
}

async function clearField(locator: Locator): Promise<void> {
  await locator.fill('').catch(() => undefined);
}

/**
 * Type value into a field using one of 10 human-like patterns.
 * For masked phones pass digits-only national number (10 digits).
 */
export async function typeWithBehavior(
  locator: Locator,
  value: string,
  behavior: FillBehaviorId,
  options?: { isPhone?: boolean },
): Promise<void> {
  const isPhone = options?.isPhone === true;

  switch (behavior) {
    case 'typo_backspace': {
      if (isPhone && value.length >= 4) {
        const firstChunk = value.slice(0, Math.max(3, value.length - 3));
        const lastChunk = value.slice(firstChunk.length);
        await typeChars(locator, firstChunk, 85, 160);
        await locator.press('Backspace');
        await pause(locator, 250, 700);
        await typeChars(locator, firstChunk.slice(-1), 120, 220);
        if (lastChunk) {
          await pause(locator, 220, 650);
          await typeChars(locator, lastChunk, 80, 150);
        }
        break;
      }

      if (value.length >= 3) {
        await typeChars(locator, value.slice(0, -1), 70, 140);
        await typeChars(locator, value.slice(-2, -1) === 'а' ? 'о' : 'а', 70, 120);
        await locator.press('Backspace');
        await pause(locator, 200, 500);
        await typeChars(locator, value.slice(-1), 90, 160);
      } else {
        await typeChars(locator, value, 70, 140);
      }
      break;
    }

    case 'slow_careful':
      await typeChars(locator, value, 140, 230);
      await pause(locator, 400, 900);
      break;

    case 'fast_burst':
      await typeChars(locator, value, 25, 55);
      await pause(locator, 80, 200);
      break;

    case 'paste_instant':
      await locator.fill(value);
      await pause(locator, 150, 400);
      break;

    case 'chunk_pause': {
      const mid = Math.max(1, Math.floor(value.length / 2));
      await typeChars(locator, value.slice(0, mid), 70, 130);
      await pause(locator, 500, 1400);
      await typeChars(locator, value.slice(mid), 70, 130);
      break;
    }

    case 'select_all_retype': {
      const junk = isPhone ? '9' : 'х';
      await typeChars(locator, junk + junk, 60, 110);
      await pause(locator, 200, 500);
      await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await pause(locator, 120, 300);
      await typeChars(locator, value, 65, 120);
      break;
    }

    case 'hesitate_mid': {
      const cut = Math.max(1, Math.floor(value.length * 0.4));
      await typeChars(locator, value.slice(0, cut), 80, 150);
      await pause(locator, 700, 1800);
      await typeChars(locator, value.slice(cut), 70, 140);
      break;
    }

    case 'clear_retype': {
      const wrong = isPhone ? value.slice(0, 3) : value.slice(0, Math.min(2, value.length));
      await typeChars(locator, wrong || (isPhone ? '900' : 'Те'), 70, 120);
      await pause(locator, 300, 700);
      await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await locator.press('Backspace');
      await pause(locator, 200, 500);
      await typeChars(locator, value, 70, 135);
      break;
    }

    case 'overshoot_backspace': {
      const extra = isPhone ? String(randomInt(0, 9)) : 'ь';
      await typeChars(locator, value + extra, 70, 130);
      await pause(locator, 200, 450);
      await locator.press('Backspace');
      if (!isPhone && Math.random() > 0.5) {
        await locator.press('Backspace');
        await typeChars(locator, value.slice(-1), 80, 140);
      }
      break;
    }

    case 'two_speed': {
      const mid = Math.max(1, Math.floor(value.length / 2));
      await typeChars(locator, value.slice(0, mid), 130, 210);
      await pause(locator, 150, 400);
      await typeChars(locator, value.slice(mid), 35, 70);
      break;
    }

    default:
      await typeChars(locator, value, 70, 135);
  }
}

export async function prepareFieldForTyping(locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await pause(locator, 350, 900);
  await humanClickLocator(locator, { force: true, timeoutMs: 10000 });
  await pause(locator, 400, 1000);
  await clearField(locator);
}
