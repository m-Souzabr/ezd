import type { DesignDocument, Item } from '@ezd/core';
import type { Page } from '@playwright/test';

// Shared by the end-to-end tests: reading the document through `window.__ezd`, which the
// dev build exposes, and aiming the mouse at plan coordinates.

type Hook = {
  getDoc(): DesignDocument;
  getHistoryLength(): number;
  getViewport(): { scale: number; offsetX: number; offsetY: number };
  getPreviewDoc(): DesignDocument | null;
};

/** Sixteenths of an inch, as the document stores lengths. */
export const IN = 16;
export const STORAGE_KEY = 'ezd.design';

// Each function passed to `evaluate` runs in the page, so it reads the hook itself.
export const getDoc = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ezd: Hook }).__ezd.getDoc());
export const historyLength = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ezd: Hook }).__ezd.getHistoryLength());
export const getPreviewDoc = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ezd: Hook }).__ezd.getPreviewDoc());
export const getViewport = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ezd: Hook }).__ezd.getViewport());

/** Where a plan point, in inches, is on the page. */
export async function planPoint(page: Page, x: number, y: number) {
  const box = await page.getByTestId('canvas').boundingBox();
  if (!box) throw new Error('The canvas is not on the page');
  const viewport = await getViewport(page);
  return {
    x: box.x + viewport.offsetX + x * viewport.scale,
    y: box.y + viewport.offsetY + y * viewport.scale,
  };
}

export async function dragTo(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

/** Drags a catalog entry onto the plan, with the pointer ending at (x, y) inches. */
export async function dragFromCatalog(page: Page, catalogId: string, x: number, y: number) {
  const box = await page.getByTestId(`catalog-${catalogId}`).boundingBox();
  if (!box) throw new Error(`No catalog entry ${catalogId}`);
  await dragTo(
    page,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    await planPoint(page, x, y),
  );
}

export const offsetOf = (item: Item): number => {
  if (item.placement.type !== 'wall') throw new Error('The item is not on a wall');
  return item.placement.offset;
};

/** Opens the editor on a new design and makes a rectangle room from the template. */
export async function openWithRoom(page: Page, width = 120, depth = 96) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Room template' }).click();
  const dialog = page.getByRole('dialog', { name: 'Room template' });
  await dialog.getByLabel('Width', { exact: true }).fill(String(width));
  await dialog.getByLabel('Depth', { exact: true }).fill(String(depth));
  await dialog.getByRole('button', { name: 'Create room' }).click();
  await dialog.waitFor({ state: 'hidden' });
}
