import { expect, test, type Route } from '@playwright/test';

/**
 * TC-47 (e2e, FR-19) — the tracking list is a cross-analysis GLOBAL resource with
 * its own top-level entry. This walks the REACHABLE T5.7 flow end-to-end against
 * the production preview build (the backend is stubbed via Playwright `route`, as
 * in smoke/history): top-level nav 追蹤清單 → TrackingListsView → 建清單
 * (name/geo/language) → row 開啟 → TrackingDetailView time-series (a brand-new
 * list draws the AC-30.3 "尚無時序資料" empty state — never a fabricated 0 line).
 *
 * SCOPE SPLIT (TC-47 spans T5.7 + T6.4): the "勾選 (results-page per-row checkbox) →
 * bulk 建清單" entry point is covered end-to-end by `tracking-select.spec.ts` (T6.4,
 * now that view-content routing mounts the results table + selectionStore/BulkSelectBar
 * into the dashboard route). This file covers the top-level 追蹤清單 entry point.
 */

const LIST_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const LIST_NAME = 'E2E 追蹤清單';

/** Empty-axis series → the AC-30.3 first-run empty state. */
function emptySeries(listId: string) {
  return {
    list: { listId, name: LIST_NAME, geo: 'TW', language: 'zh-TW' },
    axis: [],
    total: [],
    members: [],
    summary: { memberCount: 0, latestFetchedAt: null },
  };
}

test('top-level 追蹤清單 → create → open detail time-series (reachable T5.7 flow)', async ({
  page,
}) => {
  // The shell reads GET /views on mount — stub it so it doesn't fall back noisily.
  await page.route(/\/api\/v1\/views/, (route) => route.fulfill({ json: { views: [] } }));

  // GET (list) vs POST (create) share the same URL — split on method. GET starts empty;
  // the view appends the created list locally (optimistic), so no growing GET needed.
  await page.route(/\/api\/v1\/tracking-lists($|\?)/, (route: Route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 201,
        json: {
          listId: LIST_ID,
          name: LIST_NAME,
          geo: 'TW',
          language: 'zh-TW',
          createdAt: '2026-07-21T00:00:00.000Z',
        },
      });
    }
    return route.fulfill({ json: [] });
  });

  // Detail time-series for the newly-created (empty) list.
  await page.route(/\/api\/v1\/tracking-lists\/[^/]+\/series/, (route) =>
    route.fulfill({ json: emptySeries(LIST_ID) }),
  );

  await page.goto('/');

  // 1) Top-level nav entry → TrackingListsView.
  await page.getByRole('link', { name: '追蹤清單' }).click();
  await expect(page).toHaveURL(/\/tracking$/);
  await expect(page.getByRole('heading', { name: '建立追蹤清單' })).toBeVisible();

  // 2) Create a list (name + geo + language).
  await page.getByLabel('清單名稱').fill(LIST_NAME);
  await page.getByLabel('地區 (geo)').fill('TW');
  await page.getByLabel('語言 (language)').fill('zh-TW');
  await page.getByRole('button', { name: '建立清單' }).click();
  await expect(page.getByText(LIST_NAME)).toBeVisible();

  // 3) Open the row → detail time-series (empty state for a brand-new list).
  await page.getByRole('button', { name: `開啟 ${LIST_NAME}` }).click();
  await expect(page).toHaveURL(new RegExp(`/tracking/${LIST_ID}$`));
  await expect(page.getByText('尚無時序資料')).toBeVisible();
});
