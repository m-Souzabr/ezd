import { expect, type Page, test } from '@playwright/test';

import { audit } from './a11y';
import { getDoc, newDesign, openDesignWithRoom, openWithRoom, signUp } from './helpers';

// The editor at 768 and 1280 px (the `tablet` and `desktop` projects): from 1024 px the catalog and
// the properties are columns; below it they are sheets opened from the toolbar, so the canvas
// keeps the width. Nothing scrolls sideways, and a sheet covers the canvas only while it is open.

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Editor' });

test('the panels are columns on a desktop and sheets on a tablet', async ({ page }, testInfo) => {
  const viewport = testInfo.project.name;
  await openWithRoom(page);
  const canvas = page.getByTestId('canvas');
  const width = page.viewportSize()!.width;
  expect(await noHorizontalScroll(page)).toBe(true);

  if (viewport === 'desktop') {
    await expect(page.getByRole('region', { name: 'Catalog' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Properties' })).toBeVisible();
    await expect(page.getByRole('region', { name: /^Validation/ })).toBeVisible();
    for (const name of ['Catalog', 'Properties']) {
      await expect(toolbar(page).getByRole('button', { name })).toHaveCount(0);
    }
    expect(await audit(page), 'desktop').toEqual([]);
    return;
  }

  await test.step('the canvas has the whole width, and nothing covers it', async () => {
    await expect(page.getByRole('region', { name: 'Catalog' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Properties' })).toHaveCount(0);
    expect((await canvas.boundingBox())!.width).toBeGreaterThanOrEqual(width - 1);
    // A trial click checks that the canvas is what a click at its middle would reach.
    await canvas.click({ trial: true });
    expect(await audit(page), 'tablet').toEqual([]);
  });

  await test.step('the catalog is a sheet, and adding a cabinet closes it', async () => {
    await toolbar(page).getByRole('button', { name: 'Catalog' }).click();
    const sheet = page.getByRole('dialog', { name: 'Catalog' });
    await expect(sheet.getByRole('region', { name: 'Catalog' })).toBeVisible();
    expect(await audit(page), 'catalog sheet').toEqual([]);
    await sheet.getByRole('button', { name: /^Add / }).first().click();
    await expect(sheet).toBeHidden();
    expect((await getDoc(page)).items).toHaveLength(1);
    await canvas.click({ trial: true });
  });

  await test.step('the properties and the checks are one sheet, closed with Escape', async () => {
    await toolbar(page).getByRole('button', { name: 'Properties' }).click();
    const sheet = page.getByRole('dialog', { name: 'Properties and checks' });
    await expect(sheet.getByRole('region', { name: 'Properties' })).toBeVisible();
    await expect(sheet.getByRole('region', { name: /^Validation/ })).toBeVisible();
    expect(await audit(page), 'properties sheet').toEqual([]);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await canvas.click({ trial: true });
  });

  await test.step('the materials stay under the canvas, and leave it most of the height', async () => {
    await toolbar(page).getByRole('button', { name: 'Materials' }).click();
    await expect(page.getByRole('region', { name: 'Bill of materials' })).toBeVisible();
    const height = page.viewportSize()!.height;
    expect((await canvas.boundingBox())!.height).toBeGreaterThanOrEqual(height * 0.4);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

test('the global keys wait while a sheet is open', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'The panels are columns, not sheets.');
  await openWithRoom(page);
  await toolbar(page).getByRole('button', { name: 'Catalog' }).click();
  await page
    .getByRole('dialog', { name: 'Catalog' })
    .getByRole('button', { name: /^Add / })
    .first()
    .click();
  await expect.poll(async () => (await getDoc(page)).items.length).toBe(1);

  // The cabinet is selected. With a sheet open, Delete must not remove it.
  await toolbar(page).getByRole('button', { name: 'Properties' }).click();
  await expect(page.getByRole('dialog', { name: 'Properties and checks' })).toBeVisible();
  await page.keyboard.press('Delete');
  expect((await getDoc(page)).items).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Properties and checks' })).toBeHidden();

  // Closed, the same key works again.
  await page.getByTestId('canvas').focus();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await getDoc(page)).items.length).toBe(0);
});

test('a saved design has its assistant in a column or a sheet', async ({ page }, testInfo) => {
  await signUp(page, 'layout-editor');
  await openDesignWithRoom(page, await newDesign(page));
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 15_000 });
  expect(await noHorizontalScroll(page)).toBe(true);

  if (testInfo.project.name === 'desktop') {
    await expect(page.getByRole('region', { name: 'Assistant' })).toBeVisible();
    return;
  }
  await expect(page.getByRole('region', { name: 'Assistant' })).toBeHidden();
  await toolbar(page).getByRole('button', { name: 'Assistant' }).click();
  const sheet = page.getByRole('dialog', { name: 'Assistant' });
  await expect(sheet.getByRole('region', { name: 'Assistant' })).toBeVisible();
  await expect(sheet.getByLabel('Message to the assistant')).toBeVisible();
});
