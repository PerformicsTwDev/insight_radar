import { expect, test } from '@playwright/test';
import { stubAnalysisStatus } from '../support/stubs';
import { CHART_DIFF, completedSnapshot, stubFullViews } from './support';

// Visual regression — TC-50 (NFR-6, FR-8/14): the 意圖佔比樹狀圖 (topics treemap).
// See ./README.md + `.claude/rules/visual-regression.md`.
//
// A completed analysis whose `topics` feature is already `ready` renders the topics
// content directly (`GET :id/topics` stubbed with a fixed cluster set); the 表格|圖表
// toggle switches to the treemap. The treemap is a squarified DOM data-viz (`意圖佔比樹狀圖`),
// so this uses the 圖表-class 0.05 tolerance (rule §3). Baselines are generated + verified
// ONLY inside `mcr.microsoft.com/playwright:v1.61.1-noble` (rule §1/§2 — never macOS/arm64).

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const TOPICS_URL = new RegExp(`/api/v1/keyword-analyses/${ANALYSIS_ID}/topics`);
const DASHBOARD = `/?analysisId=${ANALYSIS_ID}&view=intent_topics`;

const cluster = (
  topicName: string,
  parentTopic: string,
  intentLabel: string,
  clusterVolume: number,
  keywordCount: number,
) => ({
  topicName,
  parentTopic,
  intentLabel,
  topicType: 'head',
  reason: null,
  clusterVolume,
  keywordCount,
  confidence: 0.8,
  representativeKeywords: [topicName],
});

const TOPICS_BODY = {
  status: 'completed',
  progress: null,
  clusters: [
    cluster('跑鞋推薦', '跑鞋', 'commercial', 9000, 12),
    cluster('越野跑鞋', '跑鞋', 'commercial', 5200, 8),
    cluster('慢跑鞋評價', '跑鞋', 'informational', 3400, 6),
    cluster('跑鞋價格', '跑鞋', 'transactional', 2100, 4),
    cluster('跑鞋品牌比較', '跑鞋', 'commercial', 1500, 3),
  ],
  keywords: [],
  meta: { runId: 'run-1', snapshotId: 'snap-1', clusterCount: 5, noiseCount: 0 },
};

test('意圖佔比樹狀圖 matches visual baseline (TC-50)', async ({ page }) => {
  await stubFullViews(page);
  await stubAnalysisStatus(page, ANALYSIS_ID, completedSnapshot({ topics: { status: 'ready' } }));
  await page.route(TOPICS_URL, (route) => route.fulfill({ json: TOPICS_BODY }));

  await page.goto(DASHBOARD);

  // Ready content renders the 主題表 first (default 表格 tab) → switch to 圖表.
  await expect(page.getByText('跑鞋推薦')).toBeVisible();
  await page.getByRole('tab', { name: '圖表' }).click();

  const treemap = page.getByRole('img', { name: '意圖佔比樹狀圖' });
  await expect(treemap).toBeVisible();

  await expect(treemap).toHaveScreenshot('intent-treemap.png', CHART_DIFF);
});
