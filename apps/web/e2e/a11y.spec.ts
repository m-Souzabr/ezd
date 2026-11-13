import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { audit } from './a11y';
import { api, newDesign, signUp } from './helpers';

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
