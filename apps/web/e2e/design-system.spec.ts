import { type Browser, expect, type Page, test } from '@playwright/test';

import { audit, auditFocus } from './a11y';
import { ADMINISTRATOR, api, newDesign, signIn, signUp } from './helpers';

// Every screen, in both themes, at the size of the project (`phone`, `tablet`, `desktop`): it
// passes the audit in a11y.ts (names, labels, dialogs, contrast, 44 px targets on touch), shows
// a visible focus ring as you Tab, and does not scroll sideways. The theme is set the way a
// user's choice is kept, in `localStorage` under `app-theme`, before the page loads.

const THEMES = ['light', 'dark'] as const;
const ADMIN_SECTIONS = [
  'catalog',
  'rules',
  'app',
  'quotes',
  'backup',
  'ai',
  'users',
  'roles',
  'audit',
];

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function themedPage(browser: Browser, theme: string, sized: Page, touch: boolean) {
  const context = await browser.newContext({ viewport: sized.viewportSize(), hasTouch: touch });
  await context.addInitScript((value) => localStorage.setItem('app-theme', value), theme);
  return context.newPage();
}

async function check(page: Page, name: string, theme: string, options: { focus?: boolean } = {}) {
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('status').filter({ hasText: /^Loading/ })).toHaveCount(0);
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark).*$/);
  expect(await noHorizontalScroll(page), `${name} (${theme}) scrolls sideways`).toBe(true);
  expect(await audit(page), `${name} (${theme})`).toEqual([]);
  if (options.focus !== false)
    expect(await auditFocus(page), `${name} (${theme}) focus`).toEqual([]);
}

for (const theme of THEMES) {
  test(`the gallery, the sign-in page and the account pages, ${theme}`, async ({
    browser,
    page: sized,
  }, testInfo) => {
    test.setTimeout(150_000);
    const page = await themedPage(browser, theme, sized, testInfo.project.use.hasTouch ?? false);
    await page.goto('/design-system');
    await check(page, '/design-system', theme);
    await page.goto('/login');
    await check(page, '/login', theme);

    await signUp(page, 'ds');
    const designId = await newDesign(page, 'Kitchen');
    const design = await api<{ project: string }>(page, 'GET', `/api/designs/${designId}/`);
    await page.goto('/projects');
    await check(page, '/projects', theme);
    await page.goto(`/projects/${design.project}`);
    await check(page, 'a project', theme);

    await page.goto(`/designs/${designId}`);
    await expect(page.getByTestId('canvas')).toBeVisible({ timeout: 20_000 });
    await check(page, 'the editor', theme, { focus: false });
    await page.context().close();
  });

  test(`the Control Panel, ${theme}`, async ({ browser, page: sized }, testInfo) => {
    test.setTimeout(180_000);
    const page = await themedPage(browser, theme, sized, testInfo.project.use.hasTouch ?? false);
    await signIn(page, ADMINISTRATOR);
    await page.goto('/admin');
    await check(page, '/admin', theme);
    for (const section of ADMIN_SECTIONS) {
      await page.goto(`/admin/${section}`);
      await check(page, `/admin/${section}`, theme);
    }
    await page.context().close();
  });
}

test('the theme choice survives a reload', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.evaluate(() => localStorage.setItem('app-theme', 'dark'));
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem('app-theme'))).toBe('dark');
});
