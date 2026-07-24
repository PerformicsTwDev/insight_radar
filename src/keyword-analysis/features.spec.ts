import { aiSearchFeatureStatus, computeFeatures } from './features';

/** T6.8（FR-14 · AC-14.7）：feature 狀態推導。keyword_metrics 由 snapshot/job 狀態推導；serp/topics 尚未實作 → not_generated。 */
describe('computeFeatures (T6.8)', () => {
  it('keyword_metrics=ready when a snapshot exists (completed / persisted partial)', () => {
    expect(
      computeFeatures({ status: 'completed', resultSnapshotId: 'snap-1' }).keyword_metrics,
    ).toEqual({
      status: 'ready',
    });
    // 已持久化 partial：仍有不可變 snapshot → ready。
    expect(
      computeFeatures({ status: 'partial', resultSnapshotId: 'snap-2' }).keyword_metrics,
    ).toEqual({
      status: 'ready',
    });
  });

  it('keyword_metrics=running while queued/running/unpersisted-partial (no snapshot yet)', () => {
    for (const status of ['queued', 'running', 'partial'] as const) {
      expect(computeFeatures({ status, resultSnapshotId: null }).keyword_metrics.status).toBe(
        'running',
      );
    }
  });

  it('keyword_metrics=failed / not_generated for terminal non-ready states', () => {
    expect(
      computeFeatures({ status: 'failed', resultSnapshotId: null }).keyword_metrics.status,
    ).toBe('failed');
    expect(
      computeFeatures({ status: 'canceled', resultSnapshotId: null }).keyword_metrics.status,
    ).toBe('not_generated');
  });

  it('serp is not_generated (SERP compute not wired); topics not_generated with no run', () => {
    const features = computeFeatures({ status: 'completed', resultSnapshotId: 'snap-1' });
    expect(features.serp).toEqual({ status: 'not_generated' });
    expect(features.topics).toEqual({ status: 'not_generated' }); // no TopicRun → gated (see derives test)
  });

  it('ai_search is not_generated when there is no linked AiSearchRun (T15.8a / #678 G1)', () => {
    // 無 linked run（extras.aiSearchStatus 省略）→ not_generated（AC-44.2）；有 run → 見下方 derives 測試。
    const features = computeFeatures({ status: 'completed', resultSnapshotId: 'snap-1' });
    expect(features.ai_search).toEqual({ status: 'not_generated' });
  });

  it('journey derives from the latest JourneyRun status (T12.6 / AC-33.6)', () => {
    const ready = { status: 'completed' as const, resultSnapshotId: 'snap-1' };
    const derive = (journeyStatus?: string) =>
      computeFeatures(ready, { journeyStatus }).journey.status;
    expect(derive(undefined)).toBe('not_generated'); // 無 run
    expect(derive('canceled')).toBe('not_generated');
    expect(derive('queued')).toBe('running');
    expect(derive('running')).toBe('running');
    expect(derive('completed')).toBe('ready');
    expect(derive('partial')).toBe('ready');
    expect(derive('failed')).toBe('failed');
  });

  it('ai_search derives from the latest linked AiSearchRun status (T15.8a / #678 G1 / AC-44.2)', () => {
    // #678 G1: ai_search was permanently hard-coded not_generated → 9 AI views always 409. It must now
    // derive from the analysis's latest linked AiSearchRun.status (Option A link), mirroring journey.
    const ready = { status: 'completed' as const, resultSnapshotId: 'snap-1' };
    const derive = (aiSearchStatus?: string) =>
      computeFeatures(ready, { aiSearchStatus }).ai_search.status;
    expect(derive(undefined)).toBe('not_generated'); // 無 linked run
    expect(derive('canceled')).toBe('not_generated');
    expect(derive('queued')).toBe('running');
    expect(derive('running')).toBe('running');
    expect(derive('completed')).toBe('ready'); // T15.5 已落 ai_answers/ai_visibility_metrics
    expect(derive('partial')).toBe('ready');
    expect(derive('failed')).toBe('failed');
  });

  it('topics derives from the latest TopicRun status (M7-R7a / AC-14.7; was hardcoded not_generated)', () => {
    // M8 topics is complete → features.topics must report the run status (AC-14.7), mirroring
    // journey/ai_search, so 意圖主題 shows its table on revisit instead of re-showing the CTA.
    const ready = { status: 'completed' as const, resultSnapshotId: 'snap-1' };
    const derive = (topicsStatus?: string) =>
      computeFeatures(ready, { topicsStatus }).topics.status;
    expect(derive(undefined)).toBe('not_generated'); // 無 run
    expect(derive('canceled')).toBe('not_generated');
    expect(derive('queued')).toBe('running');
    expect(derive('running')).toBe('running');
    expect(derive('completed')).toBe('ready');
    expect(derive('partial')).toBe('ready');
    expect(derive('failed')).toBe('failed');
  });
});

/** T15.8a（#678 G1 / AC-44.2 / S25）：`aiSearchFeatureStatus` 純函式——鏡射 `journeyFeatureStatus`。 */
describe('aiSearchFeatureStatus (T15.8a / #678 G1)', () => {
  it('maps AiSearchRun.status → feature status (completed/partial→ready, queued/running→running, failed→failed, none/canceled→not_generated)', () => {
    expect(aiSearchFeatureStatus('completed')).toBe('ready');
    expect(aiSearchFeatureStatus('partial')).toBe('ready');
    expect(aiSearchFeatureStatus('queued')).toBe('running');
    expect(aiSearchFeatureStatus('running')).toBe('running');
    expect(aiSearchFeatureStatus('failed')).toBe('failed');
    expect(aiSearchFeatureStatus('canceled')).toBe('not_generated');
    expect(aiSearchFeatureStatus(undefined)).toBe('not_generated');
  });
});
