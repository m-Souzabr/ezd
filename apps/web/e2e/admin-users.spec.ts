import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { ADMINISTRATOR, newEmail, signIn, signUp, submitLogin, SUPPORT } from './helpers';

// The Control Panel's user manager. The API starts with an administrator and a support user
// (`tests/fixtures/staff.json`), and writes its emails to files (EMAIL_FILE_PATH).

const EMAILS = resolve(import.meta.dirname, '../test-results/emails');

async function emailedLink(email: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const files = await readdir(EMAILS).catch(() => [] as string[]);
    for (const file of files) {
      const text = await readFile(resolve(EMAILS, file), 'utf8');
      if (text.includes(`To: ${email}`)) {
        const link = /http\S+\/reset-password\?\S+/.exec(text)?.[0];
        if (link) return new URL(link).pathname + new URL(link).search;
      }
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`No email for ${email}`);
}

test('an administrator invites a user and deactivates them, who can then no longer sign in', async ({
  browser,
  page,
}) => {
  const email = newEmail('invited');
  const password = 'a-fresh-horse-battery';

  await test.step('invite from the Control Panel', async () => {
    await signIn(page, ADMINISTRATOR);
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Invite user' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite a user' });
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByRole('button', { name: 'Send invite' }).click();
    await expect(dialog).toBeHidden();
    await page.getByLabel('Search').fill(email);
    await expect(page.getByRole('button', { name: email })).toBeVisible();
  });

  const invited = await (await browser.newContext()).newPage();
  await test.step('the invited user chooses a password and signs in', async () => {
    await invited.goto(await emailedLink(email));
    await invited.getByLabel('New password').fill(password);
    await invited.getByRole('button', { name: 'Change password' }).click();
    await expect(invited.getByRole('status')).toHaveText(/Your password was changed/);
    await signIn(invited, email, password);
  });

  await test.step('the administrator deactivates them', async () => {
    await page.getByRole('button', { name: email }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /^Deactivate/ }).click();
    await dialog.getByRole('button', { name: /Confirm deactivate/ }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('link', { name: 'Audit' }).click();
    await expect(page.getByRole('cell', { name: 'user.update' }).first()).toBeVisible();
  });

  await test.step('their session ended and they can no longer sign in', async () => {
    await invited.goto('/projects');
    await expect(invited).toHaveURL(/\/login/);
    await submitLogin(invited, email, password);
    await expect(invited.getByRole('alert')).toBeVisible();
    await expect(invited).toHaveURL(/\/login/);
  });
});

test('a support user manages users but cannot change roles', async ({ page }) => {
  await signIn(page, SUPPORT);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/users$/);

  const nav = page.getByRole('navigation', { name: 'Control Panel' });
  await expect(nav.getByRole('link', { name: 'Users' })).toBeVisible();
  await expect(nav.getByText('AI')).toHaveCount(0);
  await expect(nav.getByText('Audit')).toHaveCount(0);

  await page.getByRole('button', { name: ADMINISTRATOR }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Name')).toBeVisible();
  await expect(dialog.getByText('Roles')).toHaveCount(0);

  await test.step('the server refuses role changes too', async () => {
    const status = await page.evaluate(async () => {
      const token = /csrftoken=([^;]+)/.exec(document.cookie)?.[1] ?? '';
      const response = await fetch('/api/admin/users/9002/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': token },
        body: JSON.stringify({ roles: ['Administrator'] }),
      });
      return response.status;
    });
    expect(status).toBe(403);
  });

  await page.goto('/admin/audit');
  await expect(page.getByText('Your role does not include this section.')).toBeVisible();
});

test('someone who is not staff is sent away from the Control Panel', async ({ page }) => {
  await signUp(page, 'plain');
  await page.goto('/admin/users');
  await expect(page).not.toHaveURL(/\/admin/);
  await page.goto('/admin/nowhere');
  await expect(page).not.toHaveURL(/\/admin/);
});

test('an unknown admin path stays in the Control Panel, and the old AI page redirects', async ({
  page,
}) => {
  await signIn(page, ADMINISTRATOR);
  await page.goto('/admin/nowhere');
  await expect(page.getByRole('navigation', { name: 'Control Panel' })).toBeVisible();

  await page.goto('/settings/ai');
  await expect(page).toHaveURL(/\/admin\/ai$/);
  await expect(page.getByRole('heading', { name: 'AI settings' })).toBeVisible();
  await expect(page.getByTestId('key-status')).toBeVisible();
});
