import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import {
  ADMINISTRATOR,
  api,
  dragFromCatalog,
  getDoc,
  newDesign,
  openDesignWithRoom,
  signIn,
  signUp,
} from './helpers';

// The published catalog is global, so this test runs alone, after the others, and puts it
// back as it found it (see the `config` project in playwright.config.ts).

type Version = { version: string; current: boolean };

const saved = (page: import('@playwright/test').Page) =>
  expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 15_000 });

test('a catalog editor adds a cabinet and raises a price; new sessions get both, old quotes keep theirs', async ({
  browser,
  page,
}) => {
  let quoteUrl = '';
  let quoteTotal = '';

  await test.step('a customer makes a quote at today’s prices', async () => {
    await signUp(page, 'catalog-old');
    const designId = await newDesign(page, 'Before');
    await openDesignWithRoom(page, designId);
    await dragFromCatalog(page, 'base.standard', 20, 10);
    await saved(page);
    await page.getByRole('button', { name: 'Quotes' }).click();
    await page
      .getByRole('dialog', { name: 'Quotes' })
      .getByRole('button', { name: 'New quote' })
      .click();
    const form = page.getByRole('dialog', { name: 'New quote' });
    await form.getByLabel('Customer name').fill('Grace Hopper');
    await form.getByRole('button', { name: 'Create quote' }).click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    quoteUrl = page.url();
    quoteTotal = (await page.getByTestId('quote-total').textContent()) ?? '';
    expect(quoteTotal).toMatch(/^\$[\d,]+\.\d\d$/);
  });

  const staff = await browser.newContext();
  const admin = await staff.newPage();
  await signIn(admin, ADMINISTRATOR);
  const before = await api<Version[]>(admin, 'GET', '/api/admin/catalog/versions/');
  const baseline = before.find((v) => v.current)!.version;

  await test.step('a catalog editor adds a cabinet, raises a price and publishes', async () => {
    await admin.goto('/admin/catalog');
    await expect(admin.getByRole('heading', { name: 'Catalog' })).toBeVisible();

    await admin.getByRole('button', { name: 'New cabinet' }).click();
    const dialog = admin.getByRole('dialog', { name: 'New cabinet' });
    await dialog.getByLabel(/^Id/).fill('base.e2e-deep');
    await dialog.getByLabel('Name').fill('E2E deep base');
    await dialog.getByRole('button', { name: 'Add cabinet' }).click();
    await expect(admin.getByRole('group', { name: 'Entry base.e2e-deep' })).toBeVisible();

    const deepPrice = admin.getByLabel('Base price ($)');
    await deepPrice.fill('450');
    await deepPrice.blur();

    await admin.getByRole('button', { name: /^Base cabinet/ }).click();
    const price = admin.getByLabel('Base price ($)');
    await price.fill('400');
    await price.blur();

    await admin.getByRole('button', { name: 'Publish…' }).click();
    const publish = admin.getByRole('dialog', { name: 'Publish this catalog?' });
    await expect(publish.getByText(/Entry base\.e2e-deep: added/)).toBeVisible();
    await expect(publish.getByText(/Entry base\.standard: changed price/)).toBeVisible();
    await publish.getByLabel(/Note/).fill('E2E: a deep base and dearer bases');
    await publish.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(admin.getByRole('status').filter({ hasText: 'Published as' })).toBeVisible();
    await expect(admin.getByRole('region', { name: 'Version history' })).toContainText(
      'E2E: a deep base and dearer bases',
    );
  });

  await test.step('a fresh session can place the new cabinet, at the new prices', async () => {
    const visitor = await browser.newContext();
    const fresh = await visitor.newPage();
    await signUp(fresh, 'catalog-new');
    const designId = await newDesign(fresh, 'After');
    await openDesignWithRoom(fresh, designId);
    await dragFromCatalog(fresh, 'base.e2e-deep', 20, 10);
    await dragFromCatalog(fresh, 'base.standard', 70, 10);
    const doc = await getDoc(fresh);
    expect(doc.items.map((item) => item.catalogId).sort()).toEqual([
      'base.e2e-deep',
      'base.standard',
    ]);
    await saved(fresh);

    // Both at their default size: ($450 + $25 drawer + $6 x 30 in) + ($400 + $25 + $6 x 30 in).
    await fresh.getByRole('button', { name: 'Materials' }).click();
    await expect(fresh.getByTestId('bom-subtotal')).toHaveText('$1,260.00');
    expect(quoteTotal).toBe('$325.00');
    await visitor.close();
  });

  await test.step('the old quote opens and prints with its original prices', async () => {
    await page.goto(quoteUrl);
    await expect(page.getByTestId('quote-total')).toHaveText(quoteTotal);
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download PDF' }).click(),
    ]);
    const bytes = await readFile(await file.path());
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  await test.step('rolling back puts the catalog as it was, without deleting anything', async () => {
    await api(admin, 'POST', `/api/admin/catalog/versions/${baseline}/rollback/`, {});
    const versions = await api<Version[]>(admin, 'GET', '/api/admin/catalog/versions/');
    expect(versions.length).toBe(before.length + 2);
    const current = await api<{ catalog: { entries: { id: string }[] } }>(
      admin,
      'GET',
      '/api/catalog/',
    );
    expect(current.catalog.entries.some((entry) => entry.id === 'base.e2e-deep')).toBe(false);
    await staff.close();
  });
});
