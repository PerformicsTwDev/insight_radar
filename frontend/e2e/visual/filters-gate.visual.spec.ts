import { expect, test } from '@playwright/test';
import { keywordViewRow, stubAnalysisStatus, stubKeywordsQuery } from '../support/stubs';
import { completedSnapshot, stubFullViews } from './support';

// Visual regression — TC-54 (NFR-6, FR-6/9/14): the two dashboard controls goldens —
// the 篩選 chips bar (FR-6) and the feature-gate CTA (FR-9). See ./README.md +
// `.claude/rules/visual-regression.md`. Both are crisp DOM, so they keep the global
// 0.01 tolerance (no 圖表-class relaxation). Baselines are generated + verified ONLY
// inside `mcr.microsoft.com/playwright:v1.61.1-noble` (rule §1/§2 — never macOS/arm64).

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

test('篩選 chips bar matches visual baseline (TC-54)', async ({ page }) => {
  await stubFullViews(page);
  await stubAnalysisStatus(page, ANALYSIS_ID, completedSnapshot());
  await stubKeywordsQuery(page, [keywordViewRow('running shoes')]);

  await page.goto(`/?analysisId=${ANALYSIS_ID}&view=keywords`);

  // The FilterBar renders its chip triggers regardless of the row query (FR-6).
  const chips = page.getByRole('group', { name: '篩選' });
  await expect(chips.getByRole('button', { name: '意圖類別' })).toBeVisible();

  await expect(chips).toHaveScreenshot('filter-chips.png');
});

test('意圖主題 feature-gate CTA matches visual baseline (TC-54)', async ({ page }) => {
  await stubFullViews(page);
  // A completed analysis whose `topics` feature has NOT run → the FeatureGate CTA (FR-9).
  await stubAnalysisStatus(
    page,
    ANALYSIS_ID,
    completedSnapshot({ topics: { status: 'not_generated' } }),
  );

  await page.goto(`/?analysisId=${ANALYSIS_ID}&view=intent_topics`);

  // The gate CTA is the only content in the main pane (no nav) → screenshot the pane.
  const pane = page.getByRole('main');
  await expect(pane.getByRole('button', { name: '✦ 開始分析' })).toBeVisible();

  await expect(pane).toHaveScreenshot('feature-gate.png');
});
