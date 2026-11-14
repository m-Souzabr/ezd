import { expect, type Page, test } from '@playwright/test';

import { audit } from './a11y';
import { ADMINISTRATOR, signIn, SUPPORT } from './helpers';

// The Control Panel at 375, 768 and 1280 px (the `phone`, `tablet` and `desktop` projects): the
// sidebar (or, on a phone, the sheet its header button opens) lists only the sections the role
// holds a permission for, every section can be read and nothing scrolls sideways.

const ALL = [
  'Catalog',
  'Rules',
  'App settings',
  'Quotes',
  'Backup and reset',
  'AI',
  'Users',
  'Roles',
  'Audit',
];
const SUPPORT_ONLY = ['Users', 'Roles'];

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const sidebar = (page: Page) => page.locator('[data-slot="sidebar-container"]');
const sections = (page: Page) =>
  page.getByRole('navigation', { name: 'Control Panel' }).getByRole('link');

/** Opens the sections where they are behind a button (a phone's sheet), and returns their names. */
async function visibleSections(page: Page, viewport: string): Promise<string[]> {
  if (viewport === 'phone') {
    await page.getByRole('button', { name: 'Toggle the sections' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  } else {
    await expect(sidebar(page)).toBeVisible();
    const width = (await sidebar(page).boundingBox())?.width ?? 0;
    if (viewport === 'tablet') expect(width, 'an icon-only sidebar').toBeLessThan(100);
    else expect(width, 'a full sidebar').toBeGreaterThan(200);
  }
  // Labels are hidden in an icon-only sidebar, so the accessible name is read, not the text.
  return (await sections(page).all()).length === 0
    ? []
    : await sections(page).evaluateAll((links) =>
        links.map((link) => link.textContent?.trim() || link.getAttribute('aria-label') || ''),
      );
}

for (const [who, email, expected] of [
  ['an administrator', ADMINISTRATOR, ALL],
  ['a support user', SUPPORT, SUPPORT_ONLY],
] as const) {
  test(`${who} sees only their sections, and every page fits`, async ({ page }, testInfo) => {
    const viewport = testInfo.project.name;
    await signIn(page, email);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Control Panel', level: 1 })).toBeVisible();

    await test.step('the home page has a card for each section', async () => {
      const cards = page.getByRole('list', { name: 'Sections' }).getByRole('link');
      await expect(cards).toHaveCount(expected.length);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    await test.step('the sidebar or the sheet lists the same sections', async () => {
      const names = await visibleSections(page, viewport);
      expect(names.map((name) => name.replace(/\s+/g, ' '))).toEqual(expected);
      if (viewport === 'phone') await page.keyboard.press('Escape');
    });

    for (const path of expected.map((name) =>
      name === 'App settings' ? 'app' : name === 'Backup and reset' ? 'backup' : name.toLowerCase(),
    )) {
      await test.step(`/admin/${path} can be read without scrolling sideways`, async () => {
        await page.goto(`/admin/${path}`);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
          timeout: 20_000,
        });
        await expect(page.getByRole('status').filter({ hasText: /^Loading/ })).toHaveCount(0);
        expect(await noHorizontalScroll(page), path).toBe(true);
        expect(await audit(page), path).toEqual([]);
      });
    }
  });
}
