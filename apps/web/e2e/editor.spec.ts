import type { DesignDocument } from '@ezd/core';
import { expect, test } from '@playwright/test';

import {
  dragFromCatalog,
  dragTo,
  getDoc,
  historyLength,
  IN,
  offsetOf,
  planPoint,
  STORAGE_KEY,
} from './helpers';

// The phase 4 scenario, driven by mouse coordinates on the canvas.

test('draw a room, place and resize cabinets, undo, redo and reload', async ({ page }) => {
  await page.goto('/');
  const snapshots: DesignDocument[] = [];

  await test.step('create a 120 x 96 in rectangle room from the template', async () => {
    await page.getByRole('button', { name: 'Room template' }).click();
    const dialog = page.getByRole('dialog', { name: 'Room template' });
    await dialog.getByLabel('Width', { exact: true }).fill('120');
    await dialog.getByLabel('Depth', { exact: true }).fill('96');
    await dialog.getByRole('button', { name: 'Create room' }).click();
    await expect(dialog).toBeHidden();

    const doc = await getDoc(page);
    expect(doc.room.walls).toHaveLength(4);
    expect(doc.room.walls[0]).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 120 * IN, y: 0 },
    });
    expect(doc.room.walls[1]).toMatchObject({ end: { x: 120 * IN, y: 96 * IN } });
    expect(await historyLength(page)).toBe(1);
    snapshots.push(doc);
  });

  await test.step('drag a 30 in base cabinet to wall A', async () => {
    await dragFromCatalog(page, 'base.standard', 40, 10);

    const doc = await getDoc(page);
    // One `item.add`: one more history entry and one more item.
    expect(await historyLength(page)).toBe(2);
    expect(doc.items).toHaveLength(1);
    const [first] = doc.items;
    expect(first).toMatchObject({ catalogId: 'base.standard', width: 30 * IN });
    expect(first!.placement).toMatchObject({ type: 'wall', wallId: doc.room.walls[0]!.id });
    expect(offsetOf(first!) % (3 * IN)).toBe(0);
    snapshots.push(doc);
  });

  await test.step('drag a second cabinet next to it: it sits flush', async () => {
    const first = (await getDoc(page)).items[0]!;
    const end = (offsetOf(first) + first.width) / IN;
    // An inch off flush, so the edge snap has to close the gap.
    await dragFromCatalog(page, 'base.standard', end + 15 + 1, 10);

    const doc = await getDoc(page);
    expect(await historyLength(page)).toBe(3);
    expect(doc.items).toHaveLength(2);
    expect(offsetOf(doc.items[1]!)).toBe(offsetOf(first) + first.width);
    snapshots.push(doc);
  });

  await test.step('resize the first to 36 in', async () => {
    const [first] = (await getDoc(page)).items;
    const left = offsetOf(first!) / IN;
    // Select it, then pull its left handle 6 in toward the wall start.
    const middle = await planPoint(page, left + 15, 12);
    await page.mouse.click(middle.x, middle.y);
    expect(await historyLength(page)).toBe(3);
    await dragTo(page, await planPoint(page, left, 12), await planPoint(page, left - 6, 12));

    const doc = await getDoc(page);
    expect(await historyLength(page)).toBe(4);
    const [resized, second] = doc.items;
    expect(resized!.width).toBe(576);
    expect(offsetOf(resized!) + resized!.width).toBeLessThanOrEqual(offsetOf(second!));
    await expect(page.locator('[data-rule-id="item.overlap"]')).toHaveCount(0);
    snapshots.push(doc);
  });

  await test.step('undo three times and redo three times', async () => {
    const undo = page.getByRole('button', { name: 'Undo' });
    const redo = page.getByRole('button', { name: 'Redo' });
    for (const expected of [snapshots[2], snapshots[1], snapshots[0]]) {
      await undo.click();
      expect(await getDoc(page)).toEqual(expected);
    }
    for (const expected of [snapshots[1], snapshots[2], snapshots[3]]) {
      await redo.click();
      expect(await getDoc(page)).toEqual(expected);
    }
    await expect(redo).toBeDisabled();
  });

  await test.step('place a cabinet over a door', async () => {
    await page.getByRole('radio', { name: 'Opening' }).click();
    // On the thickness of wall A, 100 in from its start.
    const onWall = await planPoint(page, 100, -2);
    await page.mouse.click(onWall.x, onWall.y);
    const door = (await getDoc(page)).room.openings[0]!;
    expect(door).toMatchObject({ kind: 'door', width: 32 * IN, height: 80 * IN });

    await dragFromCatalog(page, 'base.standard', (door.offset + door.width / 2) / IN, 10);
    expect((await getDoc(page)).items).toHaveLength(3);
    await expect(page.locator('[data-rule-id="item.blocks-door"]').first()).toBeVisible();
  });

  await test.step('reload the page: the design is restored', async () => {
    const before = await getDoc(page);
    // The design is saved 500 ms after the last command.
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
      .toBe(JSON.stringify(before, null, 2));
    await page.reload();
    await expect(page.getByTestId('canvas')).toBeVisible();
    expect(await getDoc(page)).toEqual(before);
    await expect(page.locator('[data-rule-id="item.blocks-door"]').first()).toBeVisible();
  });
});

test('a drag dropped outside the canvas or cancelled with Escape changes nothing', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Room template' }).click();
  await page.getByRole('button', { name: 'Create room' }).click();
  expect(await historyLength(page)).toBe(1);

  const entry = await page.getByTestId('catalog-base.standard').boundingBox();
  if (!entry) throw new Error('No catalog entry');
  const start = { x: entry.x + entry.width / 2, y: entry.y + entry.height / 2 };

  // Dropped on the catalog panel itself.
  await dragTo(page, start, { x: start.x + 20, y: start.y + 120 });
  expect(await historyLength(page)).toBe(1);

  // Dragged over the plan, then cancelled.
  const over = await planPoint(page, 40, 10);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(over.x, over.y, { steps: 8 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await historyLength(page)).toBe(1);
  expect((await getDoc(page)).items).toHaveLength(0);
});
