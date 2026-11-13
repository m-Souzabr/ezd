import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { newEmail, PASSWORD } from './helpers';

// Accounts through the UI: sign up, sign out, sign in, and a password reset by email. The
// test API writes emails to files (EMAIL_FILE_PATH in playwright.config.ts).

const EMAILS = resolve(import.meta.dirname, '../test-results/emails');

async function resetLink(email: string): Promise<string> {
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
  throw new Error(`No reset email for ${email}`);
}

test('sign up, sign out, sign in, and reset a forgotten password', async ({ page }) => {
  const email = newEmail('auth');

  await test.step('sign up', async () => {
    await page.goto('/register');
    await page.getByLabel('Name').fill('Ada');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByText(email)).toBeVisible();
  });

  await test.step('sign out', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/login\?next=%2Fprojects$/);
  });

  await test.step('a wrong password is refused; the right one signs in', async () => {
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await page.getByRole('button', { name: 'Sign out' }).click();
  });

  const newPassword = 'another-horse-battery';
  await test.step('reset the password from the emailed link', async () => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send the link' }).click();
    await page.goto(await resetLink(email));
    await page.getByLabel('New password').fill(newPassword);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('status')).toHaveText(/Your password was changed/);
  });

  await test.step('only the new password works', async () => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByLabel('Password').fill(newPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/projects$/);
  });
});
