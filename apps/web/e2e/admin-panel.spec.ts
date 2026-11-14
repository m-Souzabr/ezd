import { readFile } from 'node:fs/promises';

import { type Browser, expect, type Page, test } from '@playwright/test';

import {
  ADMINISTRATOR,
  api,
  CATALOG_EDITOR,
  SECOND_ADMINISTRATOR,
  signIn,
  SUPPORT,
} from './helpers';

// The Control Panel as a whole (Phase 15): what each role sees, a stale draft, an import, a reset,
// the audit viewer, a publish with its dry run and a rollback, and a role edit taking effect.
// These share the one draft with the config, catalog and rules specs, so they run last, in order.

test.describe.configure({ mode: 'serial' });

type Draft = { revision: number; app_config: unknown; rules_config: unknown };
type Version = { number: number; status: string };

async function asUser(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email);
  return page;
}

const SECTIONS = (page: Page) =>
  page.getByRole('navigation', { name: 'Control Panel' }).getByRole('link');

test('each role sees only the sections it holds a permission for', async ({ browser }) => {
  const expected: [string, string[]][] = [
    [
      ADMINISTRATOR,
      [
        'Catalog',
        'Rules',
        'App settings',
        'Quotes',
        'Backup and reset',
        'AI',
        'Users',
        'Roles',
        'Audit',
      ],
    ],
    [SUPPORT, ['Users', 'Roles']],
    [CATALOG_EDITOR, ['Catalog', 'Backup and reset']],
  ];
  for (const [email, sections] of expected) {
    const page = await asUser(browser, email);
    await page.goto('/admin');
    await expect(SECTIONS(page)).toHaveText(sections);
    await page.context().close();
  }

  await test.step('a role with no access is told so, and the server refuses as well', async () => {
    const page = await asUser(browser, CATALOG_EDITOR);
    await page.goto('/admin/audit');
    await expect(page.getByText('Your role does not include this section.')).toBeVisible();
    const status = await page.evaluate(
      async () => (await fetch('/api/admin/audit/', { credentials: 'same-origin' })).status,
    );
    expect(status).toBe(403);
    await page.context().close();
  });
});

test('two editors of one draft cannot overwrite each other, and the second is told who got there first', async ({
  browser,
}) => {
  const first = await asUser(browser, ADMINISTRATOR);
  const second = await asUser(browser, SECOND_ADMINISTRATOR);
  await first.goto('/admin/app');
  await second.goto('/admin/app');
  const toggle = (page: Page) => page.getByLabel('Properties window', { exact: true });
  await expect(toggle(first)).toBeChecked();
  await expect(toggle(second)).toBeChecked();

  await test.step('the first editor saves', async () => {
    await toggle(first).uncheck();
    await first.getByRole('button', { name: 'Save draft' }).click();
    await expect(first.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();
  });

  await test.step('the second editor is refused, with a name and a way to the other draft', async () => {
    await toggle(second).uncheck();
    await second.getByRole('button', { name: 'Save draft' }).click();
    const alert = second.getByRole('alert').filter({ hasText: 'Someone else changed the draft' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(ADMINISTRATOR);
    await expect(alert).toContainText('yours are not saved');
  });

  await test.step('nothing was overwritten, and a reload shows the first editor’s draft', async () => {
    const draft = await api<Draft>(first, 'GET', '/api/admin/config/draft/');
    expect(JSON.stringify(draft.app_config)).toContain('"visible":false');
    await second.getByRole('button', { name: 'Reload the latest draft' }).click();
    await expect(toggle(second)).not.toBeChecked();
  });
  await first.context().close();
  await second.context().close();
});

test('importing an invalid file changes nothing; a valid one replaces the draft after a confirm', async ({
  browser,
}) => {
  const page = await asUser(browser, ADMINISTRATOR);
  const before = await api<Draft>(page, 'GET', '/api/admin/config/draft/');
  await page.goto('/admin/backup');

  const choose = (name: string, body: string) =>
    page
      .getByLabel('Configuration file')
      .setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(body) });

  await test.step('a file that is not JSON is refused in the browser', async () => {
    await choose('notes.txt', 'these are not settings');
    await expect(page.getByText('notes.txt is not a JSON file.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import as draft' })).toBeDisabled();
  });

  await test.step('a file the server refuses lists each problem', async () => {
    const bad = {
      format: 'ezd-config',
      formatVersion: 1,
      config: { rules_config: { thresholds: { minAisle: 1 } } },
    };
    await choose('bad.json', JSON.stringify(bad));
    await page.getByRole('button', { name: 'Import as draft' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'nothing was changed' });
    await expect(alert).toContainText('thresholds.minAisle');
    const after = await api<Draft>(page, 'GET', '/api/admin/config/draft/');
    expect(after.revision).toBe(before.revision);
    expect(after.rules_config).toEqual(before.rules_config);
  });

  await test.step('a valid file is saved as a draft, never published', async () => {
    const published = await api<Version[]>(page, 'GET', '/api/admin/config/versions/');
    const exported = await api<object>(page, 'GET', '/api/admin/config/export/');
    await choose('export.json', JSON.stringify(exported));
    await page.getByRole('button', { name: 'Import as draft' }).click();
    // The earlier test left a draft: it is not overwritten until the user agrees.
    await expect(page.getByRole('alert').filter({ hasText: 'There is a draft' })).toContainText(
      SECOND_ADMINISTRATOR.replace('admin2', 'admin') === ADMINISTRATOR ? ADMINISTRATOR : '@',
    );
    await page.getByRole('button', { name: 'Replace the draft…' }).click();
    await page
      .getByRole('dialog', { name: 'Replace the draft?' })
      .getByRole('button', { name: 'Replace the draft' })
      .click();
    await expect(page.getByText(/Saved .* as drafts/)).toBeVisible();
    const after = await api<Version[]>(page, 'GET', '/api/admin/config/versions/');
    expect(after.map((v) => v.number)).toEqual(published.map((v) => v.number));
  });
  await page.context().close();
});

test('reset to defaults asks first, then saves a draft equal to the defaults', async ({
  browser,
}) => {
  const page = await asUser(browser, ADMINISTRATOR);
  await page.goto('/admin/backup');
  await page.getByRole('button', { name: 'Reset app settings…' }).click();
  const dialog = page.getByRole('dialog', { name: /Reset the app settings draft/ });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Reset app settings…' }).click();
  await dialog.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(page.getByText('The app settings draft now holds the defaults.')).toBeVisible();
  await page.goto('/admin/app');
  await expect(page.getByLabel('Properties window', { exact: true })).toBeChecked();
  await page.context().close();
});

test('the audit viewer filters, shows a readable diff and exports CSV without secrets', async ({
  browser,
}) => {
  const page = await asUser(browser, ADMINISTRATOR);
  await page.goto('/admin/audit');
  await page.getByLabel('Action').fill('config.');
  await page.getByLabel('Object type').selectOption('config_bundle');
  await expect(page.getByRole('table', { name: 'Audit log' }).getByRole('row')).not.toHaveCount(1);
  await expect(page.getByRole('cell', { name: 'config.reset' }).first()).toBeVisible();

  await test.step('a draft save opens into its changes', async () => {
    await page.getByLabel('Object type').selectOption('config_version');
    await page.getByLabel('Action').fill('config.draft.save');
    await page
      .getByText(/\d+ changes?/)
      .first()
      .click();
    await expect(page.getByRole('list', { name: /Changes in entry/ }).first()).toBeVisible();
  });

  await test.step('the CSV holds the matching rows', async () => {
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Export CSV' }).click();
    const file = await (await download).path();
    const text = await readFile(file, 'utf8');
    expect(text.split(/\r?\n/)[0]).toBe('id,time,actor,action,object_type,object_id,before,after');
    expect(text).toContain('config.draft.save');
    expect(text).not.toContain('config.reset');
    expect(text.toLowerCase()).not.toContain('password');
  });
  await page.context().close();
});

test('a rules publish shows its dry run, can be compared with the version before, and is rolled back', async ({
  browser,
}) => {
  const page = await asUser(browser, ADMINISTRATOR);
  // A known baseline: the defaults, published.
  let draft = await api<Draft>(page, 'GET', '/api/admin/config/draft/');
  draft = await api<Draft>(page, 'PUT', '/api/admin/config/draft/', {
    revision: draft.revision,
    rules_config: {},
  });
  const baseline = await api<Version>(page, 'POST', '/api/admin/config/publish/', {
    revision: draft.revision,
    note: 'panel baseline',
  });

  await page.goto('/admin/rules');
  const aisle = page.getByLabel('Minimum aisle');
  await expect(aisle).toHaveValue('36"');
  await aisle.fill('30');
  await aisle.blur();
  await page.getByRole('button', { name: 'Publish…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish these settings?' });

  await test.step('the dry run reports on existing designs before anything is published', async () => {
    const effect = dialog.getByRole('region', { name: 'Effect on existing work' });
    await expect(effect).toBeVisible();
    await expect(effect).toContainText(/checked|no designs/);
    await expect(effect).toContainText('edits you have not saved are not counted');
    const versions = await api<Version[]>(page, 'GET', '/api/admin/config/versions/');
    expect(versions[0]!.number).toBe(baseline.number);
  });

  await test.step('publishing records who published what', async () => {
    await dialog.getByLabel(/Note/).fill('Tighter aisle');
    await dialog.getByRole('button', { name: 'Publish' }).click();
    const history = page.getByRole('region', { name: 'Version history' });
    await expect(history).toContainText('Tighter aisle');
    await expect(history).toContainText(ADMINISTRATOR);
  });

  await test.step('two versions can be compared', async () => {
    const history = page.getByRole('region', { name: 'Version history' });
    await history.getByRole('button', { name: 'Compare versions…' }).click();
    await history.getByLabel('From').selectOption(String(baseline.number));
    await history.getByRole('button', { name: 'Show changes' }).click();
    await expect(history.getByText('thresholds.minAisle')).toBeVisible();
    await expect(history.getByRole('heading', { name: 'Rules' })).toBeVisible();
  });

  await test.step('one click and a confirm undo the publish', async () => {
    await page.getByRole('button', { name: `Roll back to version ${baseline.number}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Roll back', exact: true }).click();
    await expect(page.getByText(`Rolled back to version ${baseline.number}`)).toBeVisible();
    const config = await api<{ rules_config: { thresholds?: { minAisle?: number } } }>(
      page,
      'GET',
      '/api/config/',
    );
    expect(config.rules_config.thresholds?.minAisle ?? 36 * 16).toBe(36 * 16);
  });
  await page.context().close();
});

test('a catalog publish is rolled back, and the diff names the entry by id', async ({
  browser,
}) => {
  const page = await asUser(browser, ADMINISTRATOR);
  const entryId = `base.panel-${Date.now()}`;
  const before = await api<{ version: string; catalog: { entries: { id: string }[] } }>(
    page,
    'GET',
    '/api/catalog/',
  );
  const draft = await api<{ revision: number; catalog: { entries: Record<string, unknown>[] } }>(
    page,
    'GET',
    '/api/admin/catalog/draft/',
  );
  const template = before.catalog.entries.find((e) => e.id === 'base.standard')!;
  const added = await api<{ revision: number }>(page, 'POST', '/api/admin/catalog/entries/', {
    revision: draft.revision,
    entry: { ...template, id: entryId, name: 'Panel test cabinet' },
  });
  await api(page, 'POST', '/api/admin/catalog/publish/', {
    revision: added.revision,
    note: 'Add the panel test cabinet',
  });

  await page.goto('/admin/catalog');
  const history = page.getByRole('region', { name: 'Version history' });
  await expect(history).toContainText('Add the panel test cabinet');

  await test.step('the comparison lists the entry that was added', async () => {
    await history.getByRole('button', { name: 'Compare versions…' }).click();
    await history.getByLabel('From').selectOption({ label: before.version });
    await history.getByRole('button', { name: 'Show changes' }).click();
    await expect(history.getByText(`entries[${entryId}]`)).toBeVisible();
  });

  await test.step('the rollback publishes the old catalog again', async () => {
    await page.getByRole('button', { name: `Roll back to ${before.version}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Roll back', exact: true }).click();
    await expect(history).toContainText(`Rolled back to ${before.version}`);
    const now = await api<{ catalog: { entries: { id: string }[] } }>(page, 'GET', '/api/catalog/');
    expect(now.catalog.entries.map((e) => e.id)).not.toContain(entryId);
  });
  await page.context().close();
});

test('a role edit takes effect on the member’s next request, and the seeded roles are protected', async ({
  browser,
}) => {
  const admin = await asUser(browser, ADMINISTRATOR);
  const support = await asUser(browser, SUPPORT);
  const name = `Auditor ${Date.now()}`;

  await admin.goto('/admin/roles');
  await test.step('the seeded roles cannot be changed', async () => {
    await expect(admin.getByRole('button', { name: 'Edit Administrator' })).toHaveCount(0);
    await expect(admin.getByRole('button', { name: 'Edit Support' })).toHaveCount(0);
    await expect(admin.getByText('Protected').first()).toBeVisible();
  });

  await test.step('an administrator creates a role that may read the audit log', async () => {
    await admin.getByRole('button', { name: 'New role' }).click();
    const dialog = admin.getByRole('dialog', { name: 'New role' });
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByRole('checkbox', { name: /View the audit log/ }).check();
    await dialog.getByRole('button', { name: 'Create role' }).click();
    await expect(admin.getByRole('cell', { name, exact: true })).toBeVisible();
  });

  const roles = await api<{ id: number; name: string }[]>(admin, 'GET', '/api/admin/roles/');
  const role = roles.find((r) => r.name === name)!;
  const support9002 = '/api/admin/users/9002/';
  try {
    await api(admin, 'PATCH', support9002, { roles: ['Support', name] });

    await test.step('the support user gets the Audit section on their next request', async () => {
      await support.goto('/admin');
      await expect(SECTIONS(support)).toHaveText(['Users', 'Roles', 'Audit']);
      await support.goto('/admin/audit');
      await expect(support.getByRole('table', { name: 'Audit log' })).toBeVisible();
    });

    await test.step('the administrator takes the permission away', async () => {
      await admin.getByRole('button', { name: `Edit ${name}` }).click();
      const dialog = admin.getByRole('dialog', { name: `Edit ${name}` });
      await dialog.getByRole('checkbox', { name: /View the audit log/ }).uncheck();
      await dialog.getByRole('button', { name: 'Save role' }).click();
      await expect(dialog).toBeHidden();
    });

    await test.step('the next request of the support user is refused', async () => {
      const status = await support.evaluate(
        async () => (await fetch('/api/admin/audit/', { credentials: 'same-origin' })).status,
      );
      expect(status).toBe(403);
      await support.goto('/admin/audit');
      await expect(support.getByText('Your role does not include this section.')).toBeVisible();
    });
  } finally {
    await api(admin, 'PATCH', support9002, { roles: ['Support'] });
    await api(admin, 'DELETE', `/api/admin/roles/${role.id}/`);
  }
  await admin.context().close();
  await support.context().close();
});
