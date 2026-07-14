import { expect, test } from '@playwright/test';

// P0 boot smoke: the production build serves and the app shell renders.
// The app is still the boot-smoke shell (`<h1>Insight Radar</h1>`); real page
// flows arrive with M1+. This asserts the harness (build → preview → navigate)
// is wired end-to-end and stays green as the app grows.
test('app boots and renders the shell heading', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Insight Radar');
});
