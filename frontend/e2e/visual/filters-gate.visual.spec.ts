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

  // Screenshot the FeatureGate CTA pane itself (the button's container), NOT `getByRole('main')` —
  // since M7-R17 `main` is the whole 2000px results page, so the old target captured the entire
  // dashboard. The pane is a tight, stable element (the ✦ 開始分析 button's parent).
  const gateButton = page.getByRole('button', { name: '✦ 開始分析' });
  await expect(gateButton).toBeVisible();
  const pane = gateButton.locator('..');

  await expect(pane).toHaveScreenshot('feature-gate.png');
});
