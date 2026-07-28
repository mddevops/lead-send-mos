import { Locator, Page } from 'playwright';

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function bezierPoint(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;

  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

export async function humanMoveMouse(page: Page, toX: number, toY: number): Promise<void> {
  const from = page.mouse;

  const start = await page.evaluate(() => ({
    x: window.__botMouseX ?? window.innerWidth / 2,
    y: window.__botMouseY ?? window.innerHeight / 2,
  }));

  const control1X = start.x + (toX - start.x) * 0.25 + randomInt(-40, 40);
  const control1Y = start.y + (toY - start.y) * 0.15 + randomInt(-30, 30);
  const control2X = start.x + (toX - start.x) * 0.75 + randomInt(-35, 35);
  const control2Y = start.y + (toY - start.y) * 0.85 + randomInt(-25, 25);

  const steps = randomInt(18, 32);

  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const x = bezierPoint(t, start.x, control1X, control2X, toX);
    const y = bezierPoint(t, start.y, control1Y, control2Y, toY);
    await from.move(x, y);
    await page.waitForTimeout(randomInt(8, 22));
  }

  await page.evaluate(({ x, y }) => {
    window.__botMouseX = x;
    window.__botMouseY = y;
  }, { x: toX, y: toY });
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
