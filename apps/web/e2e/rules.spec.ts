import { readFile } from 'node:fs/promises';

import { expect, type Page, test } from '@playwright/test';

import {
  ADMINISTRATOR,
  api,
  dragFromCatalog,
  newDesign,
  openDesignWithRoom,
  PASSWORD,
  signIn,
  signUp,
} from './helpers';

// The published rules and quote defaults are global, so this test runs alone, after the
// others, and puts both back as it found them (see the `rules` project in
// playwright.config.ts).

type Draft = { revision: number };

const saved = (page: Page) =>
  expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 15_000 });

const AISLE = /An aisle needs at least/;

/** Publishes the defaults for both sections, through the API, as the page's staff session. */
async function publishDefaults(page: Page, note: string) {
  const draft = await api<Draft>(page, 'GET', '/api/admin/config/draft/');
  const saved = await api<Draft>(page, 'PUT', '/api/admin/config/draft/', {
    revision: draft.revision,
    rules_config: {},
    quote_defaults: {},
  });
  await api(page, 'POST', '/api/admin/config/publish/', { revision: saved.revision, note });
}

async function publishFromPage(page: Page, note: string) {
  await page.getByRole('button', { name: 'Publish…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish these settings?' });
  await dialog.getByLabel(/Note/).fill(note);
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Published as version' })).toBeVisible();
}

async function download(page: Page): Promise<Buffer> {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF' }).click(),
  ]);
  return readFile(await file.path());
}

async function makeQuote(page: Page, designId: string) {
  await page.goto(`/designs/${designId}`);
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
  return page.url();
}

test('staff change the aisle and the branding; a fresh session sees the aisle change, and old quotes keep their PDF', async ({
  browser,
  page,
}) => {
  await signIn(page, ADMINISTRATOR);
  await publishDefaults(page, 'e2e baseline');

  const customer = await browser.newContext();
  const shop = await customer.newPage();
  const email = await signUp(shop, 'rules');
  const designId = await newDesign(shop, 'Aisle');
  let firstQuote = '';
  let firstPdf: Buffer;

  await test.step('a customer has an island too near the cabinets, and quotes it', async () => {
    await openDesignWithRoom(shop, designId);
    await dragFromCatalog(shop, 'base.standard', 20, 10);
    // Far from every wall, so it stands free: about 28 in from the run along the north wall.
    await dragFromCatalog(shop, 'base.standard', 60, 64);
    await saved(shop);
    await expect(shop.getByText(AISLE).first()).toBeVisible();
    firstQuote = await makeQuote(shop, designId);
    firstPdf = await download(shop);
    expect(firstPdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  await test.step('staff lower the minimum aisle to 24 in and publish', async () => {
    await page.goto('/admin/rules');
    const aisle = page.getByLabel('Minimum aisle');
    await expect(aisle).toHaveValue('36"');
    await aisle.fill('24');
    await aisle.blur();
    await expect(page.getByTestId('rules-preview')).toContainText('With these settings');
    await publishFromPage(page, 'Allow tighter aisles');
  });

  await test.step('locked rules cannot be changed', async () => {
    await expect(page.getByLabel('Severity of item.overlap')).toBeDisabled();
    await expect(page.getByRole('switch', { name: 'item.overlap is on' })).toBeDisabled();
  });

  await test.step('staff brand the quotes and publish', async () => {
    await page.goto('/admin/quotes');
    await page.getByLabel('Company name').fill('Acme Kitchens');
    await page.getByLabel('Quote number prefix').fill('AK-');
    await page.getByLabel('Footer text').fill('Prices are good for 30 days.');
    await page.getByLabel('Tax %').fill('8.25');
    await publishFromPage(page, 'Brand the quotes');
  });

  await test.step('a fresh session no longer gets the aisle warning', async () => {
    const context = await browser.newContext();
    const fresh = await context.newPage();
    await signIn(fresh, email, PASSWORD);
    await fresh.goto(`/designs/${designId}`);
    await saved(fresh);
    await expect(fresh.getByRole('region', { name: /^Validation/ })).toBeVisible();
    await expect(fresh.getByText(AISLE)).toHaveCount(0);

    await test.step('a new quote starts from the published tax rate and is branded', async () => {
      await fresh.getByRole('button', { name: 'Quotes' }).click();
      await fresh
        .getByRole('dialog', { name: 'Quotes' })
        .getByRole('button', { name: 'New quote' })
        .click();
      await expect(
        fresh.getByRole('dialog', { name: 'New quote' }).getByLabel('Tax %'),
      ).toHaveValue('8.25');
      await fresh.keyboard.press('Escape');
      await fresh.keyboard.press('Escape');
    });

    await test.step('the first quote’s PDF is byte for byte what it was', async () => {
      await fresh.goto(firstQuote);
      await expect(fresh.getByRole('heading', { name: 'Quote 1' })).toBeVisible();
      expect((await download(fresh)).equals(firstPdf)).toBe(true);
    });

    await test.step('a quote made now is branded, so its PDF differs', async () => {
      const second = await makeQuote(fresh, designId);
      expect(second).not.toBe(firstQuote);
      const secondPdf = await download(fresh);
      expect(secondPdf.equals(firstPdf)).toBe(false);
    });
    await context.close();
  });

  await test.step('rolling back puts the aisle warning back for a new session', async () => {
    await page.goto('/admin/rules');
    await page
      .getByRole('button', { name: /^Roll back to version/ })
      .last()
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Roll back', exact: true }).click();
    await expect(page.getByText(/Rolled back to version/)).toBeVisible();
    const context = await browser.newContext();
    const fresh = await context.newPage();
    await signIn(fresh, email, PASSWORD);
    await fresh.goto(`/designs/${designId}`);
    await saved(fresh);
    await expect(fresh.getByText(AISLE).first()).toBeVisible();
    await context.close();
  });

  await publishDefaults(page, 'e2e restore');
  await customer.close();
});
