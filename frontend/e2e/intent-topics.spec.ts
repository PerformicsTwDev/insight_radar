import { expect, test } from '@playwright/test';
import { stubAnalysisStatus, stubStreamsOffline, stubViews } from './support/stubs';

/**
 * TC-45 (e2e, FR-8/9) — the 意圖主題 gate → topics job → treemap flow against the
 * production preview build (backend stubbed via `page.route`). A completed analysis
 * whose `topics` feature is `not_generated` renders the FeatureGate CTA; ✦ 開始分析
 * starts the run (`POST :id/topics`), the gate follows the job to ready via the
 * topics-status poll, and the ready content's 表格|圖表 toggle switches to the treemap.
 */

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const TOPICS_URL = new RegExp(`/api/v1/keyword-analyses/${ANALYSIS_ID}/topics`);
const DASHBOARD = `/?analysisId=${ANALYSIS_ID}&view=intent_topics`;

const TOPICS_BODY = {
  status: 'completed',
  progress: null,
  clusters: [
    {
      topicName: '跑鞋推薦',
      parentTopic: '跑鞋',
      intentLabel: 'commercial',
      topicType: 'head',
      reason: null,
      clusterVolume: 9000,
      keywordCount: 12,
      confidence: 0.8,
      representativeKeywords: ['running shoes'],
    },
    {
      topicName: '越野跑鞋',
      parentTopic: '跑鞋',
      intentLabel: 'commercial',
      topicType: 'long-tail',
      reason: null,
      clusterVolume: 3000,
      keywordCount: 5,
      confidence: 0.7,
      representativeKeywords: ['trail shoes'],
    },
  ],
  keywords: [],
  meta: { runId: 'run-1', snapshotId: 'snap-1', clusterCount: 2, noiseCount: 0 },
};

test('intent-topics gate → start → treemap (TC-45)', async ({ page }) => {
  await stubViews(page);
  await stubStreamsOffline(page);
  // Completed main analysis whose topics feature has not run yet → the gate shows its CTA.
  await stubAnalysisStatus(page, ANALYSIS_ID, {
    status: 'completed',
    features: { topics: { status: 'not_generated' } },
  });
  // POST starts the run (202); GET returns the completed topics result (status + clusters).
  await page.route(TOPICS_URL, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 202, json: { topicJobId: 'tj-1' } })
      : route.fulfill({ json: TOPICS_BODY }),
  );

  await page.goto(DASHBOARD);

  // 1) Gate CTA for a not-generated feature.
  const startCta = page.getByRole('button', { name: '✦ 開始分析' });
  await expect(startCta).toBeVisible();
  await startCta.click();

  // 2) The run settles to ready → the 主題表 renders (default 表格 tab).
  await expect(page.getByText('跑鞋推薦')).toBeVisible({ timeout: 10_000 });

  // 3) Switch the 表格|圖表 toggle to 圖表 → the treemap renders.
  await page.getByRole('tab', { name: '圖表' }).click();
  await expect(page.getByRole('img', { name: '意圖佔比樹狀圖' })).toBeVisible();
});
