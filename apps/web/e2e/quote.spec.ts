import { readFile } from 'node:fs/promises';

import { expect, type Page, test } from '@playwright/test';

import { createDesignInUi, createProjectInUi, dragFromCatalog, getDoc } from './helpers';

// The phase 7 scenario: a small kitchen, its bill of materials, a quote and its PDF.

const PASSWORD = 'correct-horse-battery';

const saved = (page: Page) =>
  expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 15_000 });

async function openNewDesign(page: Page) {
  await page.goto('/register');
  await page.getByLabel('Name').fill('Quoter');
  await page.getByLabel('Email').fill(`e2e-quote-${Date.now()}-${Math.random()}@example.com`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await createProjectInUi(page, 'Lake house');
  await page.getByRole('link', { name: 'Lake house' }).click();
  await createDesignInUi(page, 'Kitchen');
  await expect(page).toHaveURL(/\/designs\/[0-9a-f-]{36}$/);
  await saved(page);
}

/** Saves a download and returns its bytes. */
async function download(page: Page, click: () => Promise<void>): Promise<Buffer> {
  const [file] = await Promise.all([page.waitForEvent('download'), click()]);
  expect(file.suggestedFilename()).toBe('Quote 1 Lake house.pdf');
  return readFile(await file.path());
}

test('quote a small kitchen and download its PDF', async ({ page }) => {
  await openNewDesign(page);

  await test.step('build a small kitchen with a countertop', async () => {
    await page.getByRole('button', { name: 'Room template' }).click();
    const dialog = page.getByRole('dialog', { name: 'Room template' });
    await dialog.getByRole('button', { name: 'Create room' }).click();
    await expect(dialog).toBeHidden();
    await dragFromCatalog(page, 'base.standard', 20, 10);
    await dragFromCatalog(page, 'base.sink', 60, 10);
    await dragFromCatalog(page, 'wall.standard', 20, 6);
    await page.getByRole('button', { name: 'Generate countertops' }).click();
    const doc = await getDoc(page);
    expect(doc.items).toHaveLength(3);
    expect(doc.countertops.length).toBeGreaterThan(0);
    await saved(page);
  });

  let subtotal = '';
  await test.step('the bill of materials counts everything', async () => {
    await page.getByRole('button', { name: 'Materials' }).click();
    const bom = page.getByRole('region', { name: 'Bill of materials' });
    await expect(bom.getByRole('row')).toHaveCount(5);
    await expect(bom.getByText('sq ft')).toBeVisible();
    subtotal = (await page.getByTestId('bom-subtotal').textContent()) ?? '';
    expect(subtotal).toMatch(/^\$[\d,]+\.\d\d$/);
  });

  await test.step('export the bill of materials as CSV', async () => {
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(file.suggestedFilename()).toBe('Kitchen materials.csv');
    const csv = await readFile(await file.path(), 'utf8');
    const rows = csv.trim().split(/\r?\n/);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(csv).toMatch(/base\.standard|Base cabinet/);
  });

  await test.step('create a quote at the BOM total', async () => {
    await page.getByRole('button', { name: 'Quotes' }).click();
    const dialog = page.getByRole('dialog', { name: 'Quotes' });
    await expect(dialog.getByText('No quotes for this design yet.')).toBeVisible();
    await dialog.getByRole('button', { name: 'New quote' }).click();
    const form = page.getByRole('dialog', { name: 'New quote' });
    await form.getByLabel('Customer name').fill('Grace Hopper');
    await form.getByLabel('Customer email (optional)').fill('grace@example.com');
    await form.getByLabel('Notes (optional)').fill('Deliver to the side door.');
    await expect(form.getByTestId('quote-form-total')).toHaveText(subtotal);
    await form.getByRole('button', { name: 'Create quote' }).click();

    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Quote 1' })).toBeVisible();
    await expect(page.getByTestId('quote-total')).toHaveText(subtotal);
    await expect(page.getByText('version 1')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Plan of the room' })).toBeVisible();
    await expect(page.getByRole('img', { name: /^Elevation of wall/ })).toHaveCount(4);
  });

  await test.step('download the PDF, twice: the same bytes', async () => {
    const first = await download(page, () =>
      page.getByRole('button', { name: 'Download PDF' }).click(),
    );
    expect(first.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const text = first.toString('latin1');
    expect(text).toContain('/FontFile');
    expect(text).not.toMatch(/placeholder|lorem|TODO/i);

    await page.reload();
    await expect(page.getByTestId('quote-total')).toHaveText(subtotal);
    const second = await download(page, () =>
      page.getByRole('button', { name: 'Download PDF' }).click(),
    );
    expect(second.equals(first)).toBe(true);
  });

  await test.step('the design lists the quote', async () => {
    await page.getByRole('link', { name: 'Back to the design' }).click();
    await saved(page);
    await page.getByRole('button', { name: 'Quotes' }).click();
    const dialog = page.getByRole('dialog', { name: 'Quotes' });
    await expect(dialog.getByRole('listitem')).toHaveCount(1);
    await expect(dialog.getByRole('listitem')).toContainText(subtotal);
    await expect(dialog.getByRole('listitem')).toContainText('Grace Hopper');
  });
});
