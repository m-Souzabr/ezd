import { resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { audit } from './a11y';
import { api, newDesign, signUp } from './helpers';

// The account pages at 375, 768 and 1280 px (the `phone`, `tablet` and `desktop` projects):
// the navigation fits the viewport, nothing scrolls sideways, and the bottom bar's targets are
// big enough for a finger.

const PHOTO = resolve(import.meta.dirname, '../../../evals/photos/l-shape-window.jpg');
const MIN_TARGET = 44;

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** The sidebar's own box, which only a tablet or a desktop has. */
const sidebar = (page: Page) => page.locator('[data-slot="sidebar-container"]');
const bottomBar = (page: Page) => page.getByRole('navigation', { name: 'Primary' });

async function checkNavigation(page: Page, viewport: string) {
  if (viewport === 'phone') {
    await expect(bottomBar(page)).toBeVisible();
    await expect(sidebar(page)).toBeHidden();
    const links = bottomBar(page).getByRole('link');
    expect(await links.count()).toBeGreaterThan(0);
    for (const link of await links.all()) {
      const box = await link.boundingBox();
      expect(box?.height, 'a bottom bar target').toBeGreaterThanOrEqual(MIN_TARGET);
    }
    return;
  }
  await expect(bottomBar(page)).toBeHidden();
  await expect(sidebar(page)).toBeVisible();
  const width = (await sidebar(page).boundingBox())?.width ?? 0;
  if (viewport === 'tablet') expect(width, 'an icon-only sidebar').toBeLessThan(100);
  else expect(width, 'a full sidebar').toBeGreaterThan(200);
}

test('the account pages fit the viewport', async ({ page }, testInfo) => {
  const viewport = testInfo.project.name;
  await signUp(page, 'layout');
  const designId = await newDesign(page, 'Kitchen with a very long name to see how it wraps');
  const design = await api<{ project: string }>(page, 'GET', `/api/designs/${designId}/`);

  await test.step('projects', async () => {
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'E2E house' }).first()).toBeVisible();
    await checkNavigation(page, viewport);
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(await audit(page), 'projects').toEqual([]);
  });

  await test.step('a project, with the photo uploader', async () => {
    await page.goto(`/projects/${design.project}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByLabel('choose a file')).toBeAttached();
    await checkNavigation(page, viewport);
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(await audit(page), 'project').toEqual([]);
  });

  await test.step('a photo draft', async () => {
    await page.getByLabel('choose a file').setInputFiles(PHOTO);
    await page
      .getByRole('list', { name: 'Photos' })
      .getByRole('button', { name: /^Analyze/ })
      .click();
    await expect(page.getByLabel('Wall A length')).toBeVisible();
    await checkNavigation(page, viewport);
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(await audit(page), 'photo draft').toEqual([]);
  });

  await test.step('the sign-in pages have no shell and do not scroll sideways', async () => {
    await page.context().clearCookies();
    for (const path of ['/login', '/register', '/forgot-password']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await noHorizontalScroll(page), path).toBe(true);
    }
  });
});
