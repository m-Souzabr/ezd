import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

// Targets from #12: dragging over a 200-item plan at 60 frames per second, and the editor
// interactive within 3 s of a cold load on a fast 4G connection.

const FIXTURE = readFileSync(
  resolve(import.meta.dirname, '../../../packages/core/src/document/fixtures/kitchen-200.json'),
  'utf8',
);

// Chrome DevTools' "Fast 4G" preset.
const FAST_4G = {
  offline: false,
  latency: 60,
  downloadThroughput: (9 * 1024 * 1024) / 8,
  uploadThroughput: (1.5 * 1024 * 1024) / 8,
};

test('a drag over a 200-item plan', async ({ page }) => {
  await page.addInitScript((doc) => localStorage.setItem('ezd.design', doc), FIXTURE);
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  const source = await page.getByTestId('catalog-base.standard').boundingBox();
  const canvas = await page.getByTestId('canvas').boundingBox();
  if (!source || !canvas) throw new Error('No catalog entry or canvas');

  await page.evaluate(() => {
    const w = window as unknown as { frames_: number[] };
    w.frames_ = [];
    const tick = (time: number) => {
      w.frames_.push(time);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  const steps = 120;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    await page.mouse.move(
      canvas.x + canvas.width * (0.2 + 0.6 * t),
      canvas.y + canvas.height * (0.3 + 0.4 * Math.sin(t * Math.PI)),
    );
  }
  await page.mouse.up();

  const frames = await page.evaluate(() => (window as unknown as { frames_: number[] }).frames_);
  const gaps = frames
    .slice(1)
    .map((time, i) => time - frames[i]!)
    .sort((a, b) => a - b);
  const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const p95 = gaps[Math.floor(gaps.length * 0.95)]!;
  console.log(
    `drag, 200 items: ${(1000 / mean).toFixed(1)} fps mean, p95 frame ${p95.toFixed(1)} ms, ${gaps.length} frames`,
  );
  expect(1000 / mean).toBeGreaterThan(55);
});

test('a cold load of the editor on fast 4G', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', FAST_4G);
  const started = Date.now();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Room template' })).toBeEnabled();
  await expect(page.getByTestId('canvas')).toBeVisible();
  const interactive = Date.now() - started;
  console.log(`cold load on fast 4G: interactive in ${interactive} ms`);
  expect(interactive).toBeLessThan(3000);
});
