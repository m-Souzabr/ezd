import { expect, test } from '@playwright/test';

import { ADMINISTRATOR, api, signIn } from './helpers';

// The app configuration is global, so this test runs alone and leaves the published
// configuration as it found it (see the `config` project in playwright.config.ts).

type Draft = { revision: number };
type Version = { number: number; status: string };

test('staff hide the properties window and publish; a fresh session loses it; a rollback brings it back', async ({
  browser,
  page,
}) => {
  await signIn(page, ADMINISTRATOR);

  // A baseline version with the defaults, which the rollback goes back to.
  const draft = await api<Draft>(page, 'GET', '/api/admin/config/draft/');
  const saved = await api<Draft>(page, 'PUT', '/api/admin/config/draft/', {
    revision: draft.revision,
    app_config: {},
  });
  const baseline = await api<Version>(page, 'POST', '/api/admin/config/publish/', {
    revision: saved.revision,
    note: 'e2e baseline',
  });

  const visitor = async () => {
    const context = await browser.newContext();
    const fresh = await context.newPage();
    await fresh.goto('/');
    await expect(fresh.getByRole('region', { name: 'Catalog' })).toBeVisible();
    return { context, fresh };
  };

  await test.step('a fresh session shows the properties window', async () => {
    const { context, fresh } = await visitor();
    await expect(fresh.getByRole('region', { name: 'Properties' })).toBeVisible();
    await context.close();
  });

  await test.step('staff hide it and publish', async () => {
    await page.goto('/admin/app');
    await page.getByLabel('Properties window', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Publish…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Publish these settings?' });
    await dialog.getByLabel(/Note/).fill('Hide the properties window');
    await dialog.getByRole('button', { name: 'Publish' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Published as version' }),
    ).toBeVisible();
    await expect(page.getByText('Hide the properties window')).toBeVisible();
  });

  await test.step('a fresh session no longer shows it, and the editor still works', async () => {
    const { context, fresh } = await visitor();
    await expect(fresh.getByRole('region', { name: 'Properties' })).toHaveCount(0);
    await expect(fresh.getByRole('region', { name: /^Validation/ })).toBeVisible();
    await context.close();
  });

  await test.step('rolling back brings it back, as a new version', async () => {
    await page.goto('/admin/app');
    await page.getByRole('button', { name: `Roll back to version ${baseline.number}` }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Roll back', exact: true })
      .click();
    await expect(page.getByText(`Rolled back to version ${baseline.number}`)).toBeVisible();

    const { context, fresh } = await visitor();
    await expect(fresh.getByRole('region', { name: 'Properties' })).toBeVisible();
    await context.close();

    const versions = await api<Version[]>(page, 'GET', '/api/admin/config/versions/');
    expect(versions[0]!.number).toBeGreaterThan(baseline.number + 1);
    expect(versions.find((v) => v.number === baseline.number)?.status).toBe('superseded');
  });
});
