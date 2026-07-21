import { expect, test } from '@playwright/test';
import { stubViews } from './support/stubs';

/**
 * TC-46 (e2e, FR-12) — login → session → 401-expiry redirect against the production
 * preview build (backend stubbed via `page.route`). A successful `POST /auth/login`
 * returns the user to the app; a later protected request that 401s (an expired
 * session) is caught by the global auth interceptor, which routes the user to /login
 * (preserving the deep link it was on for post-login return, AC-12.1).
 */

const LOGIN_URL = /\/api\/v1\/auth\/login/;
const HISTORY_URL = /\/api\/v1\/keyword-analyses(\?|$)/;

test('login succeeds, then a 401 on an expired session redirects to /login (TC-46)', async ({
  page,
}) => {
  await stubViews(page);
  await page.route(LOGIN_URL, (route) =>
    route.fulfill({ json: { user: { id: 'u-1', email: 'user@example.com' } } }),
  );

  // 1) Log in from /login → returns to the app home (no pending deep link).
  await page.goto('/login');
  await page.getByRole('textbox', { name: '電子郵件' }).fill('user@example.com');
  await page.getByLabel('密碼').fill('correct horse');
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page).toHaveURL(/\/(\?|$)/);
  await expect(page.getByRole('heading', { name: '關鍵字分析' })).toBeVisible();

  // 2) The session expires: the next protected request 401s → the interceptor redirects.
  await page.route(HISTORY_URL, (route) => route.fulfill({ status: 401, json: {} }));
  await page.getByRole('link', { name: '分析歷史' }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: '登入 Insight Radar' })).toBeVisible();
});
