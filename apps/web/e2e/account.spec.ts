import { expect, type Page, test } from '@playwright/test';

import { dragFromCatalog, getDoc, IN, STORAGE_KEY } from './helpers';

// The phase 6 scenario: an account, a design kept on the server, and its versions.

const PASSWORD = 'correct-horse-battery';
/** A new account for each run, so a rerun against the same API does not collide. */
const newEmail = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

const saved = (page: Page) =>
  expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 15_000 });

async function register(page: Page, email: string) {
  await page.goto('/register');
  await page.getByLabel('Name').fill('End To End');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function createRoom(page: Page) {
  await page.getByRole('button', { name: 'Room template' }).click();
  const dialog = page.getByRole('dialog', { name: 'Room template' });
  await dialog.getByRole('button', { name: 'Create room' }).click();
  await expect(dialog).toBeHidden();
}

test('register, design on the server, reload, save a version and restore it', async ({ page }) => {
  const email = newEmail();

  await test.step('register and land on an empty project list', async () => {
    await register(page, email);
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(page.getByText('No projects yet.')).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
  });

  await test.step('create a project and a design in it', async () => {
    await page.getByLabel('New project').fill('Lake house');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.getByRole('link', { name: 'Lake house' }).click();
    await expect(page.getByRole('heading', { name: 'Lake house' })).toBeVisible();

    await page.getByLabel('New design').fill('Kitchen');
    await page.getByRole('button', { name: 'Create design' }).click();
    await expect(page).toHaveURL(/\/designs\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('design-name')).toHaveText('Kitchen');
    await saved(page);
  });

  const designId = page.url().split('/').at(-1)!;

  await test.step('draw a room and add a cabinet: it is saved', async () => {
    await createRoom(page);
    await dragFromCatalog(page, 'base.standard', 40, 10);
    const doc = await getDoc(page);
    expect(doc.id).toBe(designId);
    expect(doc.items).toHaveLength(1);
    await expect(page.getByTestId('save-status')).toHaveText('Saving…');
    await saved(page);
  });

  const withOneCabinet = await getDoc(page);

  await test.step('reload: the cabinet is still there', async () => {
    await page.reload();
    await saved(page);
    expect(await getDoc(page)).toEqual(withOneCabinet);
    // Nothing of it was kept in the browser's own design.
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
  });

  await test.step('save a version', async () => {
    await page.getByRole('button', { name: 'Versions' }).click();
    const dialog = page.getByRole('dialog', { name: 'Version history' });
    await expect(dialog.getByText('No versions saved yet.')).toBeVisible();
    await dialog.getByLabel('Label (optional)').fill('One cabinet');
    await dialog.getByRole('button', { name: 'Save version' }).click();
    await expect(dialog.getByRole('listitem')).toContainText(['Version 1']);
    await expect(dialog.getByRole('listitem')).toContainText(['One cabinet']);
    await dialog.getByRole('button', { name: 'Close' }).click();
  });

  await test.step('change the design: a second cabinet is saved', async () => {
    const first = withOneCabinet.items[0]!;
    if (first.placement.type !== 'wall') throw new Error('The cabinet is not on a wall');
    const end = (first.placement.offset + first.width) / IN;
    await dragFromCatalog(page, 'base.standard', end + 16, 10);
    expect((await getDoc(page)).items).toHaveLength(2);
    await saved(page);
  });

  await test.step('preview the version read-only', async () => {
    await page.getByRole('button', { name: 'Versions' }).click();
    await page.getByRole('button', { name: 'Preview version 1' }).click();
    await expect(page.getByRole('heading', { name: /Version 1/ })).toBeVisible();
    await expect(page.getByText('Read-only preview of a saved version.')).toBeVisible();
    expect((await getDoc(page)).items).toHaveLength(2);
    await page.getByRole('button', { name: 'Back to the draft' }).click();
    await expect(page.getByRole('toolbar', { name: 'Editor' })).toBeVisible();
  });

  await test.step('restore the version: one cabinet again, with an empty history', async () => {
    await page.getByRole('button', { name: 'Versions' }).click();
    const dialog = page.getByRole('dialog', { name: 'Version history' });
    await dialog.getByRole('button', { name: 'Restore version 1' }).click();
    await dialog.getByRole('button', { name: 'Confirm restoring version 1' }).click();
    await expect(dialog).toBeHidden();

    await expect.poll(async () => (await getDoc(page)).items.length).toBe(1);
    expect(await getDoc(page)).toEqual(withOneCabinet);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await saved(page);

    await page.reload();
    await saved(page);
    expect(await getDoc(page)).toEqual(withOneCabinet);
  });

  await test.step('sign out: the design needs a session again', async () => {
    await page.getByRole('link', { name: 'Back to project' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto(`/designs/${designId}`);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Fdesigns%2F${designId}$`));
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(new RegExp(`/designs/${designId}$`));
    await saved(page);
    expect(await getDoc(page)).toEqual(withOneCabinet);
  });
});

/** Registers, and opens a new design with a room in it. Returns the design's URL. */
async function newDesign(page: Page): Promise<string> {
  await register(page, newEmail());
  await page.getByLabel('New project').fill('Cabin');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('link', { name: 'Cabin' }).click();
  await page.getByLabel('New design').fill('Kitchen');
  await page.getByRole('button', { name: 'Create design' }).click();
  await expect(page).toHaveURL(/\/designs\/[0-9a-f-]{36}$/);
  await createRoom(page);
  await saved(page);
  return page.url();
}

test('editing goes on while offline and is saved when the connection returns', async ({
  page,
  context,
}) => {
  await newDesign(page);

  await context.setOffline(true);
  await dragFromCatalog(page, 'base.standard', 40, 10);
  await expect(page.getByTestId('save-status')).toHaveText('Offline (retrying)', {
    timeout: 15_000,
  });
  // Still editable, and the work is also kept in the browser.
  await dragFromCatalog(page, 'base.standard', 90, 10);
  const offline = await getDoc(page);
  expect(offline.items).toHaveLength(2);
  const backup = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? 'null') as { document: unknown } | null,
    `ezd.backup.${offline.id}`,
  );
  expect(backup?.document).toEqual(offline);

  await context.setOffline(false);
  await saved(page);
  expect(await page.evaluate((key) => localStorage.getItem(key), `ezd.backup.${offline.id}`)).toBe(
    null,
  );
  await page.reload();
  await saved(page);
  expect(await getDoc(page)).toEqual(offline);
});

test('a save over a newer one is refused: reload theirs, or overwrite with mine', async ({
  page,
  context,
  browserName,
}) => {
  // WebKit slows the timers of the tab in the background, and every step here waits for
  // an autosave in one tab or the other.
  test.slow(browserName === 'webkit');
  const url = await newDesign(page);
  const other = await context.newPage();
  await other.goto(url);
  await saved(other);

  // The other tab saves first, so this tab's next save is from a stale revision.
  await dragFromCatalog(other, 'base.standard', 40, 10);
  await saved(other);
  const theirs = await getDoc(other);

  await page.bringToFront();
  await dragFromCatalog(page, 'wall.standard', 90, 10);
  const conflict = page.getByRole('dialog', { name: 'This design was changed elsewhere' });
  await expect(conflict).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('save-status')).toHaveText('Conflict');

  await test.step('reload theirs', async () => {
    await conflict.getByRole('button', { name: 'Reload theirs' }).click();
    await expect(conflict).toBeHidden();
    await saved(page);
    expect(await getDoc(page)).toEqual(theirs);
  });

  await test.step('overwrite with mine', async () => {
    await other.bringToFront();
    await dragFromCatalog(other, 'base.standard', 90, 10);
    await saved(other);

    await page.bringToFront();
    await dragFromCatalog(page, 'wall.standard', 90, 10);
    await expect(conflict).toBeVisible({ timeout: 15_000 });
    const mine = await getDoc(page);
    await conflict.getByRole('button', { name: 'Overwrite with mine' }).click();
    await expect(conflict).toBeHidden();
    await saved(page);

    await other.bringToFront();
    await other.reload();
    await saved(other);
    expect(await getDoc(other)).toEqual(mine);
  });
});

test('a design made without an account is imported into the account', async ({ page }) => {
  await page.goto('/');
  await createRoom(page);
  await dragFromCatalog(page, 'base.standard', 40, 10);
  const local = await getDoc(page);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key) !== null, STORAGE_KEY))
    .toBe(true);

  await page.getByRole('link', { name: 'Create account' }).click();
  await page.getByLabel('Name').fill('Importer');
  await page.getByLabel('Email').fill(newEmail());
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.getByRole('button', { name: 'Import into account' }).click();
  await expect(page).toHaveURL(/\/designs\/[0-9a-f-]{36}$/);
  await saved(page);
  const imported = await getDoc(page);
  expect(imported).toEqual({ ...local, id: page.url().split('/').at(-1) });
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
});
