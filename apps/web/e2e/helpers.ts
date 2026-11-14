import type { DesignDocument, Item } from '@ezd/core';
import { expect, type Page } from '@playwright/test';

// Shared by the end-to-end tests: reading the document through `window.__ezd`, which the
// dev build exposes, and aiming the mouse at plan coordinates.

type Hook = {
  getDoc(): DesignDocument;
  getHistoryLength(): number;
  getViewport(): { scale: number; offsetX: number; offsetY: number };
  getPreviewDoc(): DesignDocument | null;
};

/** Sixteenths of an inch, as the document stores lengths. */
export const IN = 16;
export const STORAGE_KEY = 'ezd.design';

// Each function passed to `evaluate` runs in the page, so it reads the hook itself.
export const getDoc = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ezd: Hook }).__ezd.getDoc());
export const historyLength = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ezd: Hook }).__ezd.getHistoryLength());
export const getPreviewDoc = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ezd: Hook }).__ezd.getPreviewDoc());
export const getViewport = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ezd: Hook }).__ezd.getViewport());

/** Where a plan point, in inches, is on the page. */
export async function planPoint(page: Page, x: number, y: number) {
  const box = await page.getByTestId('canvas').boundingBox();
  if (!box) throw new Error('The canvas is not on the page');
  const viewport = await getViewport(page);
  return {
    x: box.x + viewport.offsetX + x * viewport.scale,
    y: box.y + viewport.offsetY + y * viewport.scale,
  };
}

export async function dragTo(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

/** Drags a catalog entry onto the plan, with the pointer ending at (x, y) inches. */
export async function dragFromCatalog(page: Page, catalogId: string, x: number, y: number) {
  const box = await page.getByTestId(`catalog-${catalogId}`).boundingBox();
  if (!box) throw new Error(`No catalog entry ${catalogId}`);
  await dragTo(
    page,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    await planPoint(page, x, y),
  );
}

export const offsetOf = (item: Item): number => {
  if (item.placement.type !== 'wall') throw new Error('The item is not on a wall');
  return item.placement.offset;
};

/** Opens the editor on a new design and makes a rectangle room from the template. */
export async function openWithRoom(page: Page, width = 120, depth = 96) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Room template' }).click();
  const dialog = page.getByRole('dialog', { name: 'Room template' });
  await dialog.getByLabel('Width', { exact: true }).fill(String(width));
  await dialog.getByLabel('Depth', { exact: true }).fill(String(depth));
  await dialog.getByRole('button', { name: 'Create room' }).click();
  await dialog.waitFor({ state: 'hidden' });
}

export const PASSWORD = 'correct-horse-battery';

/** A new address for each test, so tests and reruns against one API never collide. */
export const newEmail = (tag = 'e2e') =>
  `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;

/**
 * Sends a request to the API as the page's browser context, with the CSRF token, so the
 * page shares the session it sets up. For seeding data without going through the UI.
 */
export async function api<T>(page: Page, method: string, path: string, data?: unknown): Promise<T> {
  if (!(await page.context().cookies()).some((cookie) => cookie.name === 'csrftoken')) {
    await page.request.get('/api/auth/me/');
  }
  const token = (await page.context().cookies()).find((c) => c.name === 'csrftoken')?.value ?? '';
  const response = await page.request.fetch(path, {
    method,
    headers: { 'X-CSRFToken': token, Accept: 'application/json' },
    ...(data !== undefined && { data }),
  });
  if (!response.ok())
    throw new Error(`${method} ${path}: ${response.status()} ${await response.text()}`);
  return (response.status() === 204 ? undefined : await response.json()) as T;
}

/** A new signed-in account, made through the API. */
export async function signUp(page: Page, tag = 'e2e') {
  const email = newEmail(tag);
  await api(page, 'POST', '/api/auth/register/', { email, password: PASSWORD, name: 'End To End' });
  return email;
}

/** A project with one empty design, made through the API. Returns the design's id. */
export async function newDesign(page: Page, name = 'Kitchen'): Promise<string> {
  const project = await api<{ id: string }>(page, 'POST', '/api/projects/', { name: 'E2E house' });
  const design = await api<{ id: string }>(page, 'POST', `/api/projects/${project.id}/designs/`, {
    name,
  });
  return design.id;
}

/** Opens a design and makes a rectangle room from the template. */
export async function openDesignWithRoom(page: Page, designId: string) {
  await page.goto(`/designs/${designId}`);
  await page.getByRole('button', { name: 'Room template' }).click();
  const dialog = page.getByRole('dialog', { name: 'Room template' });
  await dialog.getByRole('button', { name: 'Create room' }).click();
  await expect(dialog).toBeHidden();
}

/** The staff accounts the test API starts with (`apps/api/tests/fixtures/staff.json`). */
export const ADMINISTRATOR = 'admin-e2e@example.com';
export const SUPPORT = 'support-e2e@example.com';
export const CATALOG_EDITOR = 'catalog-e2e@example.com';
export const SECOND_ADMINISTRATOR = 'admin2-e2e@example.com';

/** Fills in the login page and submits it, whatever the answer. */
export async function submitLogin(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Signs in through the login page and waits for the session to start. */
export async function signIn(page: Page, email: string, password = PASSWORD) {
  await submitLogin(page, email, password);
  await expect(page).toHaveURL(/\/projects$/);
}

/** On the projects page: makes a project through the New project dialog. */
export async function createProjectInUi(page: Page, name: string) {
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Project name').fill(name);
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(dialog).toBeHidden();
}

/** On a project's page: makes a design through the New design dialog, which opens it. */
export async function createDesignInUi(page: Page, name: string) {
  await page.getByRole('button', { name: 'New design' }).click();
  const dialog = page.getByRole('dialog', { name: 'New design' });
  await dialog.getByLabel('Design name').fill(name);
  await dialog.getByRole('button', { name: 'Create design' }).click();
}
