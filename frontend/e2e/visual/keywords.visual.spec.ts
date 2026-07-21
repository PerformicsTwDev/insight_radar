import { expect, test } from '@playwright/test';
import { keywordRow, keywordsBody, stubAnalysisStatus } from '../support/stubs';
import { completedSnapshot, stubFullViews } from './support';

// Visual regression — TC-49 (NFR-6, FR-4/14): the 搜尋詞總表 (keywords grand table).
// See ./README.md and `.claude/rules/visual-regression.md`. The 趨勢 half of TC-49 is
// `trend.visual.spec.ts`; the FilterBar chips (TC-54) are `filters-gate.visual.spec.ts`.
//
// A completed analysis is opened straight at `view=keywords` (URL-is-state) with a
// fixed, stubbed row set (deterministic — the rows carry no timestamps). The `搜尋詞總表`
// role=table is a stable screenshot target; the surrounding nav / filter chrome is
// captured by other TCs. Baselines are generated + verified ONLY inside
// `mcr.microsoft.com/playwright:v1.61.1-noble` (rule §1/§2 — never macOS/arm64).

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const KEYWORDS_URL = new RegExp(`/api/v1/keyword-analyses/${ANALYSIS_ID}/keywords`);
const DASHBOARD = `/?analysisId=${ANALYSIS_ID}&view=keywords`;

test('搜尋詞總表 matches visual baseline (TC-49)', async ({ page }) => {
  await stubFullViews(page);
  await stubAnalysisStatus(page, ANALYSIS_ID, completedSnapshot());
  await page.route(KEYWORDS_URL, (route) =>
    route.fulfill({
      json: keywordsBody(
        [
          keywordRow('running shoes'),
          keywordRow('trail shoes', {
            avgMonthlySearches: 8600,
            competition: 'MEDIUM',
            competitionIndex: 55,
            cpcLow: 0.9,
            cpcHigh: 2.1,
          }),
          keywordRow('waterproof hiking boots', {
            intentLabels: ['transactional'],
            avgMonthlySearches: 4200,
            competition: 'LOW',
            competitionIndex: 22,
            cpcLow: 0.6,
            cpcHigh: 1.4,
          }),
        ],
        { total: 3 },
      ),
    }),
  );

  await page.goto(DASHBOARD);

  const table = page.getByRole('table', { name: '搜尋詞總表' });
  await expect(table.getByText('running shoes')).toBeVisible();
  await expect(table.getByText('waterproof hiking boots')).toBeVisible();

  await expect(table).toHaveScreenshot('keywords-table.png');
});
