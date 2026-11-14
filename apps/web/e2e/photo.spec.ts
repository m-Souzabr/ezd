import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { createProjectInUi, getDoc, IN } from './helpers';

// The phase 9 scenario, with the API's vision model answering from e2e/llm-script.json:
// upload a photo, analyze it, type the wall lengths, confirm, and land in the editor.

const PASSWORD = 'correct-horse-battery';
const PHOTO = resolve(import.meta.dirname, '../../../evals/photos/l-shape-window.jpg');

test('upload a photo, correct the draft room and open it in the editor', async ({ page }) => {
  await test.step('sign up and open a project', async () => {
    await page.goto('/register');
    await page.getByLabel('Name').fill('Photographer');
    await page.getByLabel('Email').fill(`e2e-photo-${Date.now()}-${Math.random()}@example.com`);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await createProjectInUi(page, 'Photo house');
    await page.getByRole('link', { name: 'Photo house' }).click();
  });

  await test.step('upload the photo and analyze it', async () => {
    await page.getByLabel('choose a file').setInputFiles(PHOTO);
    const photos = page.getByRole('list', { name: 'Photos' });
    await expect(photos.getByRole('img')).toBeVisible();
    await photos.getByRole('button', { name: /^Analyze/ }).click();
    await expect(page).toHaveURL(/\/photo-drafts\/[0-9a-f-]{36}$/);
  });

  await test.step('nothing can be confirmed until the walls are measured', async () => {
    const confirm = page.getByRole('button', { name: 'Confirm and open the editor' });
    await expect(confirm).toBeDisabled();
    await expect(page.getByLabel('Wall A length')).toHaveValue('140"');
    await page.getByLabel('Wall A length').fill('144');
    await page.getByLabel('Wall A length').press('Enter');
    await expect(confirm).toBeDisabled();
    await page.getByRole('button', { name: 'Confirm Wall B length' }).click();
    await expect(confirm).toBeEnabled();
    await confirm.click();
  });

  await test.step('the editor opens on the confirmed room', async () => {
    await expect(page).toHaveURL(/\/designs\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('design-name')).toHaveText('Kitchen from photo');
    const doc = await getDoc(page);
    expect(doc.room.walls).toHaveLength(2);
    expect(doc.room.walls[0]).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 144 * IN, y: 0 } });
    expect(doc.room.walls[1]).toMatchObject({ end: { x: 144 * IN, y: 120 * IN } });
    expect(doc.room.openings.map((opening) => [opening.kind, opening.offset / IN])).toEqual([
      ['window', 40],
      ['door', 88],
    ]);
    expect(doc.items.map((item) => [item.catalogId, item.width / IN])).toEqual([
      ['base.standard', 30],
      ['base.sink', 36],
    ]);
    await page.getByRole('button', { name: 'Photo' }).click();
    await expect(page.getByRole('complementary', { name: 'Reference photo' })).toBeVisible();
  });
});
