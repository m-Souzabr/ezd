import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { audit } from './a11y';
import { ADMINISTRATOR, api, newDesign, signIn, signUp } from './helpers';

// Every page that is not the canvas passes the audit in a11y.ts. The canvas is covered by
// its keyboard and text alternatives in the editor's own tests.

test('the pages outside the editor pass the accessibility audit', async ({ page }) => {
  for (const path of ['/login', '/register', '/forgot-password']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await audit(page), path).toEqual([]);
  }

  await signUp(page, 'a11y');
  const designId = await newDesign(page);
  const design = await api<{ project: string }>(page, 'GET', `/api/designs/${designId}/`);
  for (const path of ['/projects', `/projects/${design.project}`]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await audit(page), path).toEqual([]);
  }

  await page.goto(`/projects/${design.project}`);
  await page
    .getByLabel('choose a file')
    .setInputFiles(resolve(import.meta.dirname, '../../../evals/photos/l-shape-window.jpg'));
  await page
    .getByRole('list', { name: 'Photos' })
    .getByRole('button', { name: /^Analyze/ })
    .click();
  await expect(page.getByLabel('Wall A length')).toBeVisible();
  expect(await audit(page), 'photo draft').toEqual([]);
});

test('the editor around the canvas passes the accessibility audit', async ({ page }) => {
  await signUp(page, 'a11y-editor');
  await page.goto(`/designs/${await newDesign(page)}`);
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 15_000 });
  expect(await audit(page), 'editor').toEqual([]);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Room template' })).toBeVisible();
  expect(await audit(page), 'local editor').toEqual([]);
});

test('the Control Panel pages pass the accessibility audit and its dialogs manage focus', async ({
  page,
}) => {
  // Nine sections, each loaded and audited, then three dialog checks.
  test.setTimeout(150_000);
  await signIn(page, ADMINISTRATOR);
  for (const section of [
    'catalog',
    'rules',
    'app',
    'quotes',
    'backup',
    'ai',
    'users',
    'roles',
    'audit',
  ]) {
    await page.goto(`/admin/${section}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Wait for the section's data, so the audit sees the form and not "Loading…".
    await expect(page.getByRole('status').filter({ hasText: /^Loading/ })).toHaveCount(0);
    expect(await audit(page), section).toEqual([]);
  }

  await test.step('keyboard: the audit filters are reached in order, with labels', async () => {
    await page.goto('/admin/audit');
    await page.getByLabel('Who').focus();
    // A date input has a stop for each of its parts, so the last filter is not one Tab further.
    for (const label of ['Action', 'Object type', 'From']) {
      await page.keyboard.press('Tab');
      await expect(page.getByLabel(label)).toBeFocused();
    }
  });

  await test.step('a dialog takes focus, keeps it, and gives it back when it closes', async () => {
    await page.goto('/admin/roles');
    const open = page.getByRole('button', { name: 'New role' });
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'New role' });
    await expect(dialog).toBeVisible();
    expect(await audit(page), 'the role dialog').toEqual([]);
    for (let presses = 0; presses < 20; presses += 1) {
      await page.keyboard.press('Tab');
      // The trap hands focus back from its guards a moment after the press.
      await expect
        .poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), {
          message: 'focus stays in the dialog',
        })
        .toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
  });

  await test.step('an error is words and not only a color', async () => {
    await page.goto('/admin/backup');
    await page
      .getByLabel('Configuration file')
      .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{') });
    const alert = page.getByRole('alert');
    await expect(alert).toHaveText('bad.json is not a JSON file.');
  });
});
