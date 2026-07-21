import { expect, test } from '@playwright/test';
import {
  keywordRow,
  keywordsBody,
  stubAnalysisStatus,
  stubCreateAnalysis,
  stubStreamsOffline,
  stubViews,
} from './support/stubs';

/**
 * TC-43 (e2e, FR-2/3/4) — the create → progress → grand-table happy path against the
 * production preview build (backend stubbed via `page.route`). Fill the home form →
 * `POST /keyword-analyses` 202 puts the `analysisId` in the URL → the dashboard polls
 * `GET :id` and shows the live job-progress panel while running → flips to the 搜尋詞總表
 * (default `view=keywords`) the moment the run reports completed, listing its rows.
 */

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const KEYWORDS_URL = new RegExp(`/api/v1/keyword-analyses/${ANALYSIS_ID}/keywords`);

test('create an analysis → job progress → keywords grand table (TC-43)', async ({ page }) => {
  await stubViews(page);
  await stubStreamsOffline(page);
  await stubCreateAnalysis(page, ANALYSIS_ID);

  // Running for the first ~1.5s of polling, then completed — so the progress panel is
  // observable before the dashboard flips to the ready view (poll cadence = 2s).
  await stubAnalysisStatus(page, ANALYSIS_ID, (_call, elapsedMs) =>
    elapsedMs < 1500
      ? { status: 'running', progress: { phase: '擴充關鍵字', percent: 40 } }
      : { status: 'completed', features: {}, result: { resultSnapshotId: 'snap-1', count: 2 } },
  );
  await page.route(KEYWORDS_URL, (route) =>
    route.fulfill({ json: keywordsBody([keywordRow('running shoes'), keywordRow('trail shoes')]) }),
  );

  await page.goto('/');

  // 1) Fill + submit the create form (seeds + geo + language all required, FR-2).
  await page.getByLabel('種子關鍵字').fill('running shoes');
  await page.getByLabel('地區 (geo)').fill('TW');
  await page.getByLabel('語言 (language)').fill('zh-TW');
  await page.getByRole('button', { name: '建立分析' }).click();

  // 2) The URL carries the new analysisId, and the live progress panel renders.
  await expect(page).toHaveURL(new RegExp(`analysisId=${ANALYSIS_ID}`));
  await expect(page.getByText('分析進行中')).toBeVisible();

  // 3) Once the run completes the dashboard flips to the 搜尋詞總表 with its rows.
  await expect(page.getByRole('table', { name: '搜尋詞總表' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('running shoes')).toBeVisible();
  await expect(page.getByText('trail shoes')).toBeVisible();
});
