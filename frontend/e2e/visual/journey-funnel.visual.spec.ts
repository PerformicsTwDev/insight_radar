import { expect, test, type Route } from '@playwright/test';
import { stubAnalysisStatus } from '../support/stubs';
import { CHART_DIFF, completedSnapshot, stubFullViews } from './support';

// Visual regression — TC-51 (NFR-6, FR-15/14): the 購買歷程搜尋漏斗 (journey funnel).
// See ./README.md + `.claude/rules/visual-regression.md`. The funnel structure/logic
// (bar height ∝ stage volume, nodes 1→7, stage-to-stage trend %) is vitest-locked
// (`src/lib/journeyFunnel.test.ts`, `JourneyFunnel.test.tsx`); this is the pixel-golden.
//
// A completed analysis whose `journey` feature is `ready`, opened at `view=journey_funnel`
// (which routes to JourneyView with `initialMode='chart'`, T6.0), renders the funnel
// straight away from the stubbed `POST :id/query {view:'journey'}` stage rows. The funnel
// is a DOM data-viz (`購買歷程搜尋漏斗`), so this uses the 圖表-class 0.05 tolerance (rule §3).
// Baselines are generated + verified ONLY inside `mcr.microsoft.com/playwright:v1.61.1-noble`
// (rule §1/§2 — never macOS/arm64); a missing baseline is a hard red (rule §2).

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const QUERY_URL = new RegExp(`/api/v1/keyword-analyses/${ANALYSIS_ID}/query`);
const JOURNEY_URL = new RegExp(`/api/v1/keyword-analyses/${ANALYSIS_ID}/journey`);
const DASHBOARD = `/?analysisId=${ANALYSIS_ID}&view=journey_funnel`;

/** Fixed per-stage search volumes → a descending funnel (bar height ∝ volume, C-class). */
const STAGE_VOLUMES: readonly [string, number][] = [
  ['pain_awareness', 18000],
  ['need_definition', 14000],
  ['solution_exploration', 11000],
  ['spec_comparison', 8000],
  ['reputation_validation', 5000],
  ['final_decision', 3200],
  ['repurchase_retention', 1500],
];

const JOURNEY_TABLE_BODY = {
  view: 'journey',
  columns: [
    { key: 'stage', label: '階段', type: 'text' },
    { key: 'avgMonthlySearches', label: '月搜量', type: 'number' },
  ],
  rows: STAGE_VOLUMES.map(([stage, avgMonthlySearches]) => ({ stage, avgMonthlySearches })),
  pagination: { total: STAGE_VOLUMES.length, page: 1, pageSize: 25, cursor: null },
};

test('購買歷程搜尋漏斗 matches visual baseline (TC-51)', async ({ page }) => {
  await stubFullViews(page);
  await stubAnalysisStatus(page, ANALYSIS_ID, completedSnapshot({ journey: { status: 'ready' } }));
  // Journey stage 表 (view-router) → drives the funnel; run status → partial flag (false here).
  await page.route(QUERY_URL, (route: Route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ json: JOURNEY_TABLE_BODY })
      : route.fallback(),
  );
  await page.route(JOURNEY_URL, (route: Route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: { journeyJobId: 'jj-1', status: 'completed', progress: null, keywordCount: 42 },
        })
      : route.fallback(),
  );

  await page.goto(DASHBOARD);

  const funnel = page.getByRole('img', { name: '購買歷程搜尋漏斗' });
  await expect(funnel).toBeVisible();

  await expect(funnel).toHaveScreenshot('journey-funnel.png', CHART_DIFF);
});
