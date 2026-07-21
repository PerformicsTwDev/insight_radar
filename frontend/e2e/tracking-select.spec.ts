import { expect, test, type Route } from '@playwright/test';
import { keywordRow, keywordsBody, stubAnalysisStatus, stubViews } from './support/stubs';

/**
 * TC-47 results-page segment (e2e, FR-19) — the write-side bulk-add flow that T5.7
 * deferred to T6.4 (it needs the results table + selectionStore/BulkSelectBar mounted
 * into the dashboard route, which T6.0 enabled). Against the production preview build
 * (backend stubbed via `page.route`): open a completed analysis's 搜尋詞總表 (with its
 * geo/language analysis context in the URL) → check per-row selection boxes → the
 * floating bulk bar shows the deduped count → 建立新清單 (fixed at the selection's
 * geo/language) + add members → then reach the new list's detail time-series.
 *
 * The top-level 追蹤清單 → create → open-detail entry point is covered by
 * `tracking.spec.ts`; this covers the results-page selection entry point end-to-end.
 */

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const LIST_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const LIST_NAME = 'E2E 選取清單';
const KEYWORDS_URL = new RegExp(`/api/v1/keyword-analyses/${ANALYSIS_ID}/keywords`);
const DASHBOARD = `/?analysisId=${ANALYSIS_ID}&view=keywords&geo=TW&language=zh-TW`;

test('select results rows → bulk-create a tracking list → open its detail (TC-47)', async ({
  page,
}) => {
  await stubViews(page);
  await stubAnalysisStatus(page, ANALYSIS_ID, { status: 'completed', features: {} });
  await page.route(KEYWORDS_URL, (route) =>
    route.fulfill({ json: keywordsBody([keywordRow('running shoes'), keywordRow('trail shoes')]) }),
  );

  // Tracking-lists collection: GET is empty until the POST create, then lists the new one.
  let created = false;
  await page.route(/\/api\/v1\/tracking-lists(\?|$)/, (route: Route) => {
    if (route.request().method() === 'POST') {
      created = true;
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
    return route.fulfill({
      json: created
        ? [
            {
              listId: LIST_ID,
              name: LIST_NAME,
              geo: 'TW',
              language: 'zh-TW',
              createdAt: '2026-07-21T00:00:00.000Z',
              memberCount: 2,
            },
          ]
        : [],
    });
  });
  await page.route(/\/api\/v1\/tracking-lists\/[^/]+\/members(\?|$)/, (route) =>
    route.fulfill({ json: { memberCount: 2, added: 2 } }),
  );
  await page.route(/\/api\/v1\/tracking-lists\/[^/]+\/series/, (route) =>
    route.fulfill({
      json: {
        list: { listId: LIST_ID, name: LIST_NAME, geo: 'TW', language: 'zh-TW' },
        axis: [],
        total: [],
        members: [],
        summary: { memberCount: 0, latestFetchedAt: null },
      },
    }),
  );

  await page.goto(DASHBOARD);
  await expect(page.getByText('running shoes')).toBeVisible();

  // 1) Check two per-row selection boxes → the floating bulk bar reflects the count.
  await page.getByRole('checkbox', { name: '選取 running shoes' }).check();
  await page.getByRole('checkbox', { name: '選取 trail shoes' }).check();
  const bar = page.getByRole('region', { name: '批次選取' });
  await expect(bar).toBeVisible();
  await expect(bar.getByText(/已選 2 項/)).toBeVisible();

  // 2) 加入搜尋詞追蹤清單 → 建立新清單 (fixed at the selection's geo/language) → 建立並加入.
  await bar.getByRole('button', { name: '加入搜尋詞追蹤清單' }).click();
  await bar.getByRole('button', { name: '建立新清單' }).click();
  await bar.getByLabel('新清單名稱').fill(LIST_NAME);
  await bar.getByRole('button', { name: '建立並加入' }).click();

  // 3) A successful add clears the selection → the bulk bar disappears.
  await expect(bar).toBeHidden();

  // 4) Reach the new list from the top-level 追蹤清單 entry → open its detail time-series.
  await page.getByRole('link', { name: '追蹤清單' }).click();
  await expect(page).toHaveURL(/\/tracking$/);
  await page.getByRole('button', { name: `開啟 ${LIST_NAME}` }).click();
  await expect(page).toHaveURL(new RegExp(`/tracking/${LIST_ID}$`));
  await expect(page.getByText('尚無時序資料')).toBeVisible();
});
