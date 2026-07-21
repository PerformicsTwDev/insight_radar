import { expect, test } from '@playwright/test';
import { CHART_DIFF, stubFullViews } from './support';

// Visual regression — TC-53 (NFR-6, FR-19): the 追蹤詳情 time-series chart (first golden
// of the new tracking-detail design). See ./README.md + `.claude/rules/visual-regression.md`.
// The `fetchedAt`-axis series assembly + empty/null-break/member-table logic is vitest-locked
// (`src/lib/volumeSeries.test.ts`, `TrackingDetailView.test.tsx`); this is the pixel-golden.
//
// The `/tracking/$listId` route renders TrackingDetailView, which fetches the list's volume
// series (`GET :id/series`, stubbed with a fixed non-empty `axis` → the chart, not the
// AC-30.3 empty state). The chart is a Chart.js <canvas> (`搜量時序折線圖`), so this uses the
// 圖表-class 0.05 tolerance (rule §3) and Playwright screenshot stabilization for the render.
// Baselines are generated + verified ONLY inside `mcr.microsoft.com/playwright:v1.61.1-noble`
// (rule §1/§2 — never macOS/arm64); a missing baseline is a hard red (rule §2).

const LIST_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const SERIES_URL = /\/api\/v1\/tracking-lists\/[^/]+\/series/;
const AXIS = ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'];

const point = (fetchedAt: string, avgMonthlySearches: number) => ({
  fetchedAt,
  avgMonthlySearches,
  competition: 'HIGH',
  cpc: 1.8,
});

const member = (text: string, normalizedText: string, volumes: readonly number[]) => {
  const series = AXIS.map((fetchedAt, i) => point(fetchedAt, volumes[i]));
  return {
    normalizedText,
    text,
    addedAt: '2026-04-01T00:00:00.000Z',
    lastCheckedAt: '2026-07-01T00:00:00.000Z',
    latest: series[series.length - 1],
    series,
  };
};

const SERIES_BODY = {
  list: { listId: LIST_ID, name: '跑鞋追蹤清單', geo: 'TW', language: 'zh-TW' },
  axis: AXIS,
  total: [24000, 26500, 23000, 28000],
  members: [
    member('running shoes', 'running shoes', [12000, 14000, 11500, 15000]),
    member('trail shoes', 'trail shoes', [12000, 12500, 11500, 13000]),
  ],
  summary: { memberCount: 2, latestFetchedAt: '2026-07-01T00:00:00.000Z' },
};

test('追蹤詳情時序 matches visual baseline (TC-53)', async ({ page }) => {
  await stubFullViews(page);
  await page.route(SERIES_URL, (route) => route.fulfill({ json: SERIES_BODY }));

  await page.goto(`/tracking/${LIST_ID}`);

  const chart = page.getByRole('img', { name: '搜量時序折線圖' });
  await expect(chart).toBeVisible();

  await expect(chart).toHaveScreenshot('tracking-detail.png', CHART_DIFF);
});
