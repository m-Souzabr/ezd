import { expect, type Page, test } from '@playwright/test';

import { getDoc, IN, offsetOf } from './helpers';

// The editor flow without a mouse: every step is reached with Tab and done with the
// keyboard. It is the automated part of the keyboard pass in #12.

/** Presses Tab until the focused element has the accessible name, or fails. */
const focusedName = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return '';
    const labelledby = el.getAttribute('aria-labelledby');
    return (
      el.getAttribute('aria-label') ??
      (labelledby ? document.getElementById(labelledby)?.textContent : null) ??
      el.textContent ??
      ''
    ).trim();
  });

const matches = (focused: string, name: string | RegExp) =>
  typeof name === 'string' ? focused === name : name.test(focused);

async function moveTo(page: Page, key: string, name: string | RegExp, max = 80) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press(key);
    if (matches(await focusedName(page), name)) return;
  }
  throw new Error(`${key} never reached ${String(name)}`);
}

// Safari, and WebKit on macOS, reach buttons and links with Option+Tab by default.
let TAB = 'Tab';
test.beforeEach(({ browserName }) => {
  TAB = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
});

const tabTo = (page: Page, name: string | RegExp, max?: number) => moveTo(page, TAB, name, max);

/** The toolbar is one tab stop; its buttons are reached with the arrow keys. */
async function toolbarTo(page: Page, name: string) {
  await tabTo(page, 'Select');
  await moveTo(page, 'ArrowRight', name, 30);
}

test('make a room, add, move and remove a cabinet with the keyboard alone', async ({ page }) => {
  await page.goto('/');

  await toolbarTo(page, 'Room template');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Room template' });
  await expect(dialog).toBeVisible();
  // The dialog keeps the focus inside it until it closes.
  await tabTo(page, 'Create room', 10);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  expect((await getDoc(page)).room.walls).toHaveLength(4);

  await tabTo(page, 'Add Base cabinet');
  await page.keyboard.press('Enter');
  const added = (await getDoc(page)).items;
  expect(added).toHaveLength(1);

  await tabTo(page, /^Plan view of the room/);
  // Arrow keys move the selected item 3 in along its wall.
  await page.keyboard.press('ArrowRight');
  const moved = (await getDoc(page)).items[0]!;
  expect(offsetOf(moved)).toBe(offsetOf(added[0]!) + 3 * IN);

  await page.keyboard.press('Delete');
  expect((await getDoc(page)).items).toHaveLength(0);
  await page.keyboard.press('ControlOrMeta+z');
  expect((await getDoc(page)).items).toHaveLength(1);
});
