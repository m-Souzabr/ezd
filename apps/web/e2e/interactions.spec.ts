import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import {
  dragFromCatalog,
  dragTo,
  getDoc,
  getViewport,
  historyLength,
  IN,
  offsetOf,
  openWithRoom,
  planPoint,
} from './helpers';

test('the wall tool draws a closed room as one command', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Wall' }).click();

  // Three corners by clicking, off the grid by a little so the snapping has work to do.
  for (const [x, y] of [
    [0.4, -0.3],
    [119.2, 0.9],
    [120.6, 95.1],
  ] as const) {
    const point = await planPoint(page, x, y);
    await page.mouse.click(point.x, point.y);
  }
  // The fourth by typing a length, toward where the pointer is.
  const toward = await planPoint(page, 40, 96);
  await page.mouse.move(toward.x, toward.y);
  await page.getByLabel('Wall length').fill('120');
  await page.getByLabel('Wall length').press('Enter');
  expect(await historyLength(page)).toBe(0);

  // Back on the first point, which closes the room.
  const first = await planPoint(page, 1, 1);
  await page.mouse.click(first.x, first.y);

  expect(await historyLength(page)).toBe(1);
  const { walls } = (await getDoc(page)).room;
  expect(walls.map((wall) => [wall.start.x / IN, wall.start.y / IN])).toEqual([
    [0, 0],
    [120, 0],
    [120, 96],
    [0, 96],
  ]);
  expect(walls[3]!.end).toEqual({ x: 0, y: 0 });
  await expect(page.getByRole('radio', { name: 'Select' })).toBeChecked();

  await page.getByRole('button', { name: 'Undo' }).click();
  expect((await getDoc(page)).room.walls).toHaveLength(0);
});

test('Escape cancels the wall being drawn', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Wall' }).click();
  for (const [x, y] of [
    [0, 0],
    [60, 0],
  ] as const) {
    const point = await planPoint(page, x, y);
    await page.mouse.click(point.x, point.y);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('radio', { name: 'Select' })).toBeChecked();
  expect(await historyLength(page)).toBe(0);
  expect((await getDoc(page)).room.walls).toHaveLength(0);
});

test('dragging an item moves it with one command; a click only selects it', async ({ page }) => {
  await openWithRoom(page);
  await dragFromCatalog(page, 'base.standard', 40, 10);
  expect(await historyLength(page)).toBe(2);
  const before = (await getDoc(page)).items[0]!;

  const middle = await planPoint(page, offsetOf(before) / IN + 15, 12);
  await page.mouse.click(middle.x, middle.y);
  expect(await historyLength(page)).toBe(2);
  await expect(page.getByTestId('announcement')).toHaveText(/Base cabinet 30" at 24" on wall A/);

  // 30 in to the right, grabbed off-centre: the item keeps its place under the pointer.
  const grab = await planPoint(page, offsetOf(before) / IN + 5, 8);
  await dragTo(page, grab, { x: grab.x + 30 * (await getViewport(page)).scale, y: grab.y });
  expect(await historyLength(page)).toBe(3);
  const after = (await getDoc(page)).items[0]!;
  expect(offsetOf(after)).toBe(offsetOf(before) + 30 * IN);
  expect(after.placement).toMatchObject({ type: 'wall' });

  // Arrow keys nudge it 3 in; Delete removes it.
  await page.keyboard.press('ArrowLeft');
  expect(offsetOf((await getDoc(page)).items[0]!)).toBe(offsetOf(after) - 3 * IN);
  await page.keyboard.press('Control+d');
  expect((await getDoc(page)).items).toHaveLength(2);
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect((await getDoc(page)).items).toHaveLength(1);
});

test('the ghost shows what a drop would break before the drop', async ({ page }) => {
  await openWithRoom(page);
  await dragFromCatalog(page, 'base.standard', 40, 10);

  // A second cabinet held over the first: nothing is added while it is held.
  const entry = (await page.getByTestId('catalog-base.standard').boundingBox())!;
  const over = await planPoint(page, 46, 10);
  await page.mouse.move(entry.x + entry.width / 2, entry.y + entry.height / 2);
  await page.mouse.down();
  await page.mouse.move(over.x, over.y, { steps: 8 });
  expect((await getDoc(page)).items).toHaveLength(1);
  expect(await historyLength(page)).toBe(2);

  // Dropping with errors is allowed; the violation then shows in the panel.
  await page.mouse.up();
  expect((await getDoc(page)).items).toHaveLength(2);
  await expect(page.locator('[data-rule-id="item.overlap"]').first()).toBeVisible();

  // Hovering the item shows the messages.
  await page.mouse.move(over.x + 3, over.y + 3);
  await expect(page.getByRole('tooltip')).toContainText('overlaps');
});

test('the elevation shows the same wall as the plan and moves items along it', async ({ page }) => {
  await openWithRoom(page);
  await dragFromCatalog(page, 'base.standard', 40, 10);
  const before = (await getDoc(page)).items[0]!;

  await page.getByRole('radio', { name: 'Elevation A' }).click();
  await expect(page.getByRole('application', { name: /Elevation of wall A/ })).toBeVisible();

  // In an elevation x is the offset along the wall and y is up, so the middle of the
  // cabinet's front is at its offset + 15 in, about 17 in above the floor.
  const front = await planPoint(page, offsetOf(before) / IN + 15, -17);
  await dragTo(page, front, { x: front.x + 36 * (await getViewport(page)).scale, y: front.y - 40 });
  expect(await historyLength(page)).toBe(3);
  const after = (await getDoc(page)).items[0]!;
  expect(offsetOf(after)).toBe(offsetOf(before) + 36 * IN);
  // Dragging up or down does not lift it: the elevation is set in the properties panel.
  expect(after.elevation).toBe(0);
  expect(after.placement).toMatchObject({ wallId: (await getDoc(page)).room.walls[0]!.id });

  const offset = page.getByLabel(/Offset along wall A/);
  await expect(offset).toHaveValue('60"');
  await offset.fill('12 1/2');
  await offset.press('Enter');
  expect(offsetOf((await getDoc(page)).items[0]!)).toBe(12.5 * IN);
});

test('the view pans, zooms around the pointer and fits', async ({ page }) => {
  await openWithRoom(page);
  const fitted = await getViewport(page);

  const pointer = await planPoint(page, 60, 48);
  await page.mouse.move(pointer.x, pointer.y);
  await page.mouse.wheel(0, -300);
  const zoomed = await getViewport(page);
  expect(zoomed.scale).toBeGreaterThan(fitted.scale);
  // The plan point under the pointer has not moved.
  const still = await planPoint(page, 60, 48);
  expect(still.x).toBeCloseTo(pointer.x, 3);
  expect(still.y).toBeCloseTo(pointer.y, 3);

  // Middle-button drag pans.
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(pointer.x + 50, pointer.y + 20, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  const panned = await getViewport(page);
  expect(panned.offsetX).toBeCloseTo(zoomed.offsetX + 50, 3);
  expect(panned.offsetY).toBeCloseTo(zoomed.offsetY + 20, 3);
  expect(await historyLength(page)).toBe(1);

  // So does dragging with Space held, once the canvas has the focus.
  const floor = await planPoint(page, 60, 48);
  await page.mouse.click(floor.x, floor.y);
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(floor.x - 30, floor.y + 10, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  const spacePanned = await getViewport(page);
  expect(spacePanned.offsetX).toBeCloseTo(panned.offsetX - 30, 3);
  expect(spacePanned.offsetY).toBeCloseTo(panned.offsetY + 10, 3);
  expect(await historyLength(page)).toBe(1);

  await page.getByRole('button', { name: 'Fit' }).click();
  expect(await getViewport(page)).toEqual(fitted);
});

test('export followed by import yields an identical document', async ({ page }) => {
  await openWithRoom(page);
  await dragFromCatalog(page, 'base.standard', 40, 10);
  await dragFromCatalog(page, 'wall.standard', 40, 4);
  await page.getByRole('button', { name: 'Generate countertops' }).click();
  const exported = await getDoc(page);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const path = await (await download).path();
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(exported);

  // Change the design, then bring the exported one back.
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByTestId('import-file').setInputFiles(path);
  await expect.poll(() => getDoc(page)).toEqual(exported);
  expect(await historyLength(page)).toBe(0);

  // A bad file is refused with its schema errors, and the design stays as it was.
  await page.getByTestId('import-file').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...exported, items: [{ id: 'x' }] })),
  });
  await expect(page.getByRole('dialog', { name: 'The file was not imported' })).toContainText(
    'items[0].id',
  );
  expect(await getDoc(page)).toEqual(exported);
});
