import { expect, test, type Route } from '@playwright/test';
import { stubAnalysisStatus } from '../support/stubs';
import { CHART_DIFF, completedSnapshot, stubFullViews } from './support';

// Visual regression — TC-49 (NFR-6, FR-5/14): the 搜尋趨勢 line chart (the 趨勢 half of
// TC-49; the 總表 half is `keywords.visual.spec.ts`). See ./README.md +
// `.claude/rules/visual-regression.md`.
//
// A completed analysis at `view=trend` fetches `POST :id/query {view:'trend'}`; the
// stub returns a fixed `axis` + `total` aggregate line (deterministic). The chart is a
// Chart.js <canvas> (`搜尋趨勢折線圖`), so this uses the 圖表-class 0.05 tolerance (rule
// §3) and relies on Playwright's screenshot stabilization to let the Chart.js render
// settle. Baselines are generated + verified ONLY inside
// `mcr.microsoft.com/playwright:v1.61.1-noble` (rule §1/§2 — never macOS/arm64).

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const QUERY_URL = new RegExp(`/api/v1/keyword-analyses/${ANALYSIS_ID}/query`);
const DASHBOARD = `/?analysisId=${ANALYSIS_ID}&view=trend`;

const TREND_BODY = {
  view: 'trend',
  axis: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
  total: [12000, 13500, 11800, 16400, 18200, 15100],
  series: [],
};

test('搜尋趨勢折線圖 matches visual baseline (TC-49)', async ({ page }) => {
  await stubFullViews(page);
  await stubAnalysisStatus(page, ANALYSIS_ID, completedSnapshot());
  await page.route(QUERY_URL, (route: Route) =>
    route.request().method() === 'POST' ? route.fulfill({ json: TREND_BODY }) : route.fallback(),
  );

  await page.goto(DASHBOARD);

  const chart = page.getByRole('img', { name: '搜尋趨勢折線圖' });
  await expect(chart).toBeVisible();

  await expect(chart).toHaveScreenshot('trend-chart.png', CHART_DIFF);
});
