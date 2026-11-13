import { expect, test } from '@playwright/test';

import {
  dragFromCatalog,
  getDoc,
  historyLength,
  IN,
  newDesign,
  offsetOf,
  openWithRoom,
  planPoint,
  signUp,
} from './helpers';

// The editing flows of #12 that the other specs do not cover: a room from a template in a
// new project, doors and windows with the opening tool, duplicate and delete with undo and
// redo, rule feedback with a suggested fix, and the selection shared by plan and elevation.

test('a design from a room template in a new project', async ({ page }) => {
  await signUp(page, 'template');
  const designId = await newDesign(page, 'Template kitchen');
  await page.goto(`/designs/${designId}`);
  await page.getByRole('button', { name: 'Room template' }).click();
  const dialog = page.getByRole('dialog', { name: 'Room template' });
  await dialog.getByLabel('Shape').selectOption('l');
  await dialog.getByRole('button', { name: 'Create room' }).click();
  await expect(dialog).toBeHidden();
  expect((await getDoc(page)).room.walls).toHaveLength(6);
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 15_000 });
});

test('the opening tool adds a door and a window to a wall', async ({ page }) => {
  await openWithRoom(page);
  await page.getByRole('radio', { name: 'Opening' }).click();
  await page.getByRole('radio', { name: 'Door' }).click();
  const doorAt = await planPoint(page, 80, 0);
  await page.mouse.click(doorAt.x, doorAt.y);
  await page.getByRole('radio', { name: 'Window' }).click();
  const windowAt = await planPoint(page, 30, 0);
  await page.mouse.click(windowAt.x, windowAt.y);

  const { room } = await getDoc(page);
  expect(room.openings.map((opening) => [opening.kind, opening.wallId])).toEqual([
    ['door', room.walls[0]!.id],
    ['window', room.walls[0]!.id],
  ]);
  expect(room.openings[1]!.sillHeight).toBeGreaterThan(0);
  expect(await historyLength(page)).toBe(3);
});

test('duplicate and delete a cabinet, with undo and redo', async ({ page }) => {
  await openWithRoom(page);
  await dragFromCatalog(page, 'base.standard', 40, 10);
  expect((await getDoc(page)).items).toHaveLength(1);

  await page.keyboard.press('ControlOrMeta+d');
  const duplicated = await getDoc(page);
  expect(duplicated.items).toHaveLength(2);
  expect(offsetOf(duplicated.items[1]!)).not.toBe(offsetOf(duplicated.items[0]!));

  await page.keyboard.press('Delete');
  expect((await getDoc(page)).items).toHaveLength(1);

  await page.getByRole('button', { name: 'Undo' }).click();
  expect((await getDoc(page)).items).toHaveLength(2);
  await page.getByRole('button', { name: 'Redo' }).click();
  expect((await getDoc(page)).items).toHaveLength(1);
});

test('rule feedback: a blocked door, then a gap fixed with the suggested filler', async ({
  page,
}) => {
  await openWithRoom(page);

  await test.step('a cabinet in front of a door is an error', async () => {
    await page.getByRole('radio', { name: 'Opening' }).click();
    await page.getByRole('radio', { name: 'Door' }).click();
    const doorAt = await planPoint(page, 60, 0);
    await page.mouse.click(doorAt.x, doorAt.y);
    await page.getByRole('radio', { name: 'Select' }).click();
    await dragFromCatalog(page, 'base.standard', 60, 10);
    const violation = page.locator('[data-rule-id="item.blocks-door"]').first();
    await expect(violation).toBeVisible();
    await expect(violation).toContainText(/door/i);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('[data-rule-id="item.blocks-door"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
  });

  await test.step('a 3 in gap between cabinets offers a filler, which fixes it', async () => {
    const offset = page.getByLabel(/Offset along wall A/);
    await dragFromCatalog(page, 'base.standard', 20, 10);
    await offset.fill('0');
    await offset.press('Enter');
    await dragFromCatalog(page, 'base.standard', 80, 10);
    await offset.fill('33');
    await offset.press('Enter');

    const gap = page.locator('[data-rule-id="gap.needs-filler"]');
    await expect(gap).toHaveCount(1);
    await expect(gap).toContainText('Add a 3" filler.');
    await gap.getByRole('button', { name: /^Apply/ }).click();
    const fixed = await getDoc(page);
    expect(fixed.items.map((item) => item.kind).sort()).toEqual(['base', 'base', 'filler']);
    const filler = fixed.items.find((item) => item.kind === 'filler')!;
    expect([offsetOf(filler), filler.width]).toEqual([30 * IN, 3 * IN]);
    await expect(gap).toHaveCount(0);
  });
});

test('plan and elevation share the selection, and the elevation follows plan edits', async ({
  page,
}) => {
  await openWithRoom(page);
  await dragFromCatalog(page, 'base.standard', 40, 10);
  const item = (await getDoc(page)).items[0]!;

  // Click empty floor to clear the selection, then the cabinet to select it again.
  const floor = await planPoint(page, 60, 60);
  await page.mouse.click(floor.x, floor.y);
  await expect(page.getByLabel(/Offset along wall A/)).toHaveCount(0);
  const cabinet = await planPoint(page, offsetOf(item) / IN + 15, 12);
  await page.mouse.click(cabinet.x, cabinet.y);
  await expect(page.getByLabel(/Offset along wall A/)).toBeVisible();

  await page.getByRole('radio', { name: 'Elevation A' }).click();
  await expect(page.getByRole('application', { name: /Elevation of wall A/ })).toBeVisible();
  // Still selected in the elevation; an edit there is the same item in the plan.
  const offset = page.getByLabel(/Offset along wall A/);
  await expect(offset).toBeVisible();
  await offset.fill('48');
  await offset.press('Enter');
  await page.getByRole('radio', { name: 'Plan' }).click();
  expect(offsetOf((await getDoc(page)).items[0]!)).toBe(48 * IN);
  await expect(page.getByLabel(/Offset along wall A/)).toHaveValue('48"');
});
