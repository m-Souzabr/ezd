import { expect, test } from '@playwright/test';

import { newDesign, signUp } from './helpers';

test("another account cannot open a design's URL", async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  await signUp(owner, 'owner');
  const designId = await newDesign(owner, 'Private kitchen');
  await owner.goto(`/designs/${designId}`);
  await expect(owner.getByTestId('design-name')).toHaveText('Private kitchen');

  const other = await (await browser.newContext()).newPage();
  await signUp(other, 'other');
  await other.goto(`/designs/${designId}`);
  await expect(other.getByRole('heading', { name: 'Design not found' })).toBeVisible();
  await expect(other.getByText('Private kitchen')).toHaveCount(0);
});
