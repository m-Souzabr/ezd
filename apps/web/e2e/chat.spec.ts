import { expect, test } from '@playwright/test';

import {
  createDesignInUi,
  createProjectInUi,
  getDoc,
  getPreviewDoc,
  historyLength,
  newDesign,
  openDesignWithRoom,
  signUp,
} from './helpers';

// The phase 8 scenario, with the API's assistant answering from e2e/llm-script.json: ask
// for a cabinet, see it as a ghost, accept it, and undo it in one step.

const PASSWORD = 'correct-horse-battery';
const MESSAGE = 'Add a 30 inch base cabinet on wall A';

test('ask the assistant for a cabinet, accept the preview, undo it once', async ({ page }) => {
  await test.step('open a new design with a room', async () => {
    await page.goto('/register');
    await page.getByLabel('Name').fill('Chatter');
    await page.getByLabel('Email').fill(`e2e-chat-${Date.now()}-${Math.random()}@example.com`);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await createProjectInUi(page, 'Chat house');
    await page.getByRole('link', { name: 'Chat house' }).click();
    await createDesignInUi(page, 'Kitchen');
    await expect(page).toHaveURL(/\/designs\/[0-9a-f-]{36}$/);
    await page.getByRole('button', { name: 'Room template' }).click();
    const dialog = page.getByRole('dialog', { name: 'Room template' });
    await dialog.getByRole('button', { name: 'Create room' }).click();
    await expect(dialog).toBeHidden();
  });

  const before = await historyLength(page);
  const assistant = page.getByRole('region', { name: 'Assistant' });

  await test.step('the proposal is a ghost, and the design is unchanged', async () => {
    await assistant.getByLabel('Message to the assistant').fill(MESSAGE);
    await assistant.getByRole('button', { name: 'Send' }).click();
    const proposal = assistant.getByRole('group', { name: 'Proposed change' });
    await expect(proposal.getByText('Add 30" base cabinet on wall A at 0"')).toBeVisible();
    expect((await getDoc(page)).items).toHaveLength(0);
    expect((await getPreviewDoc(page))?.items).toHaveLength(1);
  });

  await test.step('accept adds the item as one undo step', async () => {
    await assistant.getByRole('button', { name: 'Accept' }).click();
    await expect(assistant.getByText('Accepted')).toBeVisible();
    const doc = await getDoc(page);
    expect(doc.items.map((item) => item.catalogId)).toEqual(['base.standard']);
    expect(await historyLength(page)).toBe(before + 1);
    expect(await getPreviewDoc(page)).toBeNull();
  });

  await test.step('one undo takes it away', async () => {
    await page.getByRole('button', { name: 'Undo' }).click();
    expect((await getDoc(page)).items).toHaveLength(0);
    expect(await historyLength(page)).toBe(before);
  });
});

test('a proposal the user rejects leaves the design as it was', async ({ page }) => {
  await signUp(page, 'chat-reject');
  await openDesignWithRoom(page, await newDesign(page));
  const before = await getDoc(page);
  const history = await historyLength(page);
  const assistant = page.getByRole('region', { name: 'Assistant' });
  await assistant.getByLabel('Message to the assistant').fill(MESSAGE);
  await assistant.getByRole('button', { name: 'Send' }).click();
  await expect(assistant.getByRole('group', { name: 'Proposed change' })).toBeVisible();
  expect((await getPreviewDoc(page))?.items).toHaveLength(1);

  await assistant.getByRole('button', { name: 'Reject' }).click();
  await expect(assistant.getByText('Rejected')).toBeVisible();
  expect(await getDoc(page)).toEqual(before);
  expect(await historyLength(page)).toBe(history);
  expect(await getPreviewDoc(page)).toBeNull();
});
