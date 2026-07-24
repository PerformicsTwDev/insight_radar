import { expect, test } from '@playwright/test';
import { keywordViewRow, stubAnalysisStatus, stubKeywordsQuery, stubViews } from './support/stubs';

/**
 * TC-44 (e2e, FR-6/7/13) — the 搜尋詞總表 filter → paginate → copy flow against the
 * production preview build (backend stubbed via `page.route`). The dashboard is opened
 * straight at a completed analysis's `view=keywords` (URL-is-state); the keywords stub
 * branches on the request query so a real re-fetch is observable when the URL changes.
 */

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const DASHBOARD = `/?analysisId=${ANALYSIS_ID}&view=keywords`;

/**
 * Keywords stub that mirrors the applied filter (`intent`) + pagination (`page`) — now carried in the
 * `POST :id/query` body (Design §5), not the URL query — into the returned row set, so a URL-driven
 * re-fetch is observable. The co-mounted 趨勢 card's `view:'trend'` request is served empty.
 */
async function stubKeywords(page: import('@playwright/test').Page): Promise<void> {
  await stubViews(page);
  await stubAnalysisStatus(page, ANALYSIS_ID, { status: 'completed', features: {} });
  await stubKeywordsQuery(page, (body) => {
    if (body.pagination?.page === 2) {
      return { rows: [keywordViewRow('page-two shoes')], meta: { total: 50, page: 2 } };
    }
    if (body.filters?.intent?.includes('commercial')) {
      return { rows: [keywordViewRow('running shoes')], meta: { total: 1 } };
    }
    return {
      rows: [keywordViewRow('running shoes'), keywordViewRow('trail shoes')],
      meta: { total: 50 },
    };
  });
}

test('applies an intent filter → chips write the URL and re-fetch the filtered rows (TC-44)', async ({
  page,
}) => {
  await stubKeywords(page);
  await page.goto(DASHBOARD);
  await expect(page.getByText('trail shoes')).toBeVisible();

  // Open the 意圖類別 chip → check 商業型 → 套用 (chips → FilterSpec → URL, FR-6).
  await page.getByRole('group', { name: '篩選' }).getByRole('button', { name: '意圖類別' }).click();
  const pop = page.getByRole('group', { name: '意圖類別 篩選' });
  await pop.getByRole('checkbox', { name: '商業型' }).check();
  await pop.getByRole('button', { name: '套用' }).click();

  // URL carries the serialized filters and the table now shows only the filtered row.
  await expect(page).toHaveURL(/filters=/);
  await expect(page.getByText('running shoes')).toBeVisible();
  await expect(page.getByText('trail shoes')).toBeHidden();
});

test('paginates to page 2 → URL page param drives the next row set (TC-44)', async ({ page }) => {
  await stubKeywords(page);
  await page.goto(DASHBOARD);
  await expect(page.getByText('running shoes')).toBeVisible();

  await page.getByRole('button', { name: '下一頁' }).click();

  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText('page-two shoes')).toBeVisible();
});

test.describe('TSV copy', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('copies the visible rows as TSV to the clipboard (TC-44, FR-13)', async ({ page }) => {
    await stubKeywords(page);
    await page.goto(DASHBOARD);
    await expect(page.getByText('running shoes')).toBeVisible();

    await page.getByRole('button', { name: '複製表格' }).click();

    // Button confirms the write, and the clipboard holds the TSV grid (header + rows).
    await expect(page.getByRole('button', { name: '✓ 已複製' })).toBeVisible();
    const tsv = await page.evaluate(() => navigator.clipboard.readText());
    expect(tsv).toContain('搜尋詞');
    expect(tsv).toContain('running shoes');
    expect(tsv).toContain('\t');
  });
});
