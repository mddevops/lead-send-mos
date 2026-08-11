import { Locator, Page } from 'playwright';

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function bezierPoint(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;

  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * Move cursor along a curved path with light tremor (not a straight line).
 */
export async function humanMoveMouse(page: Page, toX: number, toY: number): Promise<void> {
  const from = page.mouse;

  const start = await page.evaluate(() => ({
    x: window.__botMouseX ?? window.innerWidth / 2,
    y: window.__botMouseY ?? window.innerHeight / 2,
  }));

  const distance = Math.hypot(toX - start.x, toY - start.y);
  // Short hops: fewer steps; long moves: more, so path looks continuous.
  const steps = Math.max(12, Math.min(42, Math.round(distance / 18) + randomInt(10, 18)));

  const control1X = start.x + (toX - start.x) * 0.25 + randomInt(-55, 55);
  const control1Y = start.y + (toY - start.y) * 0.2 + randomInt(-45, 45);
  const control2X = start.x + (toX - start.x) * 0.75 + randomInt(-45, 45);
  const control2Y = start.y + (toY - start.y) * 0.8 + randomInt(-40, 40);

  let lastX = start.x;
  let lastY = start.y;

  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    // Ease-in-out so start/stop are slower than mid-path.
    const eased = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
    const baseX = bezierPoint(eased, start.x, control1X, control2X, toX);
    const baseY = bezierPoint(eased, start.y, control1Y, control2Y, toY);
    // Micro-tremor: avoid perfectly smooth curves.
    const tremor = step === steps ? 0 : randomInt(-2, 2);
    const x = baseX + tremor;
    const y = baseY + (step === steps ? 0 : randomInt(-2, 2));
    await from.move(x, y);
    lastX = x;
    lastY = y;
    await page.waitForTimeout(randomInt(7, 24));
  }

  // Settle on exact target with a tiny final correction.
  if (Math.hypot(lastX - toX, lastY - toY) > 1) {
    await from.move(toX, toY);
  }

  await page.evaluate(({ x, y }) => {
    window.__botMouseX = x;
    window.__botMouseY = y;
  }, { x: toX, y: toY });
}

/**
 * Scroll into view, move mouse with a human path, then click (not Playwright locator.click jump).
 */
export async function humanClickLocator(
  locator: Locator,
  options?: { force?: boolean; timeoutMs?: number },
): Promise<void> {
  const page = locator.page();
  const timeoutMs = options?.timeoutMs ?? 10000;

  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  await page.waitForTimeout(randomInt(180, 480));

  const box = await locator.boundingBox();
  if (!box || box.width < 1 || box.height < 1) {
    // Fallback when element has no box (hidden native checkbox etc.).
    await locator.click({ timeout: timeoutMs, force: options?.force ?? true });
    return;
  }

  // Aim near center, not dead-center — humans rarely click the exact middle.
  const offsetX = box.width * (0.35 + Math.random() * 0.3);
  const offsetY = box.height * (0.35 + Math.random() * 0.3);
  const targetX = box.x + offsetX;
  const targetY = box.y + offsetY;

  await humanMoveMouse(page, targetX, targetY);
  await page.waitForTimeout(randomInt(80, 220));

  try {
    await page.mouse.down();
    await page.waitForTimeout(randomInt(40, 110));
    await page.mouse.up();
  } catch {
    await locator.click({ timeout: timeoutMs, force: options?.force ?? true });
  }

  await page.waitForTimeout(randomInt(120, 320));
}

export async function humanDragLocator(page: Page, thumb: Locator, track: Locator, percent: number): Promise<void> {
  const thumbBox = await thumb.boundingBox();
  const trackBox = await track.boundingBox();

  if (!thumbBox || !trackBox) {
    return;
  }

  const startX = thumbBox.x + thumbBox.width / 2;
  const startY = thumbBox.y + thumbBox.height / 2;
  const clamped = Math.min(0.98, Math.max(0.05, percent));
  const endX = trackBox.x + trackBox.width * clamped;
  const endY = startY + randomInt(-2, 2);

  await humanMoveMouse(page, startX + randomInt(-4, 4), startY + randomInt(-3, 3));
  await page.waitForTimeout(randomInt(120, 320));
  await page.mouse.down();
  await page.waitForTimeout(randomInt(80, 180));

  const steps = randomInt(22, 36);

  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const eased = 1 - (1 - progress) ** 2;
    const x = startX + (endX - startX) * eased;
    const y = startY + (endY - startY) * eased + Math.sin(progress * Math.PI) * randomInt(0, 2);
    await page.mouse.move(x, y);
    await page.waitForTimeout(randomInt(14, 32));
  }

  await page.waitForTimeout(randomInt(60, 140));
  await page.mouse.up();
  await page.waitForTimeout(randomInt(300, 700));
}

export async function humanIdleJitter(page: Page): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const x = randomInt(Math.floor(viewport.width * 0.2), Math.floor(viewport.width * 0.8));
  const y = randomInt(Math.floor(viewport.height * 0.2), Math.floor(viewport.height * 0.7));
  await humanMoveMouse(page, x, y);
  await page.waitForTimeout(randomInt(200, 500));
}
