import { expect, test } from '@playwright/test';

/**
 * TC-48 (e2e, FR-10 / AC-10.1) — reopen a past analysis from the 分析歷史 list and
 * confirm the dashboard URL is restored with its `analysisId` (FR-1). The backend
 * is stubbed via Playwright `route` (the preview build has no API), so this asserts
 * the full list → click → URL-restore flow end-to-end without a live backend.
 */
const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

test('reopen from history restores the dashboard URL with the analysisId', async ({ page }) => {
  // The shell reads GET /views on mount — stub it so it doesn't fall back noisily.
  await page.route(/\/api\/v1\/views/, (route) => route.fulfill({ json: { views: [] } }));
  // Reopen now mounts the analysis dashboard (T6.0), which reads the authoritative
  // GET :id snapshot for readiness — stub it (still running) so the URL-restore flow
  // lands on the job-tracking panel rather than an unstubbed-request error.
  await page.route(/\/api\/v1\/keyword-analyses\/[^/?]+$/, (route) =>
    route.fulfill({ json: { status: 'running' } }),
  );
  // The history list.
  await page.route(/\/api\/v1\/keyword-analyses\?/, (route) =>
    route.fulfill({
      json: {
        data: [
          {
            analysisId: ANALYSIS_ID,
            status: 'completed',
            seeds: ['running shoes'],
            params: { mode: 'expand', geo: 'TW', language: 'zh-TW' },
            createdAt: '2026-07-10T08:00:00.000Z',
            finishedAt: '2026-07-10T08:05:00.000Z',
            resultSnapshotId: 'snap-1',
            count: 3686,
          },
        ],
        meta: { total: 1, page: 1, pageSize: 25 },
      },
    }),
  );

  await page.goto('/history');
  await expect(page.getByText('running shoes')).toBeVisible();

  await page.getByRole('button', { name: '開啟' }).click();

  await expect(page).toHaveURL(new RegExp(`analysisId=${ANALYSIS_ID}`));
});
