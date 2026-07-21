import { computeFeatures } from './features';

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

  it('serp and topics are not_generated (compute not implemented yet, M7/M8)', () => {
    const features = computeFeatures({ status: 'completed', resultSnapshotId: 'snap-1' });
    expect(features.serp).toEqual({ status: 'not_generated' });
    expect(features.topics).toEqual({ status: 'not_generated' });
  });

  it('ai_search is not_generated (AI Search compute not wired, M15/T15.6/#678)', () => {
    // AI view（ai_answers/ai_cited_*/*_ai_visibility）依賴之 → gated placeholder（AC-44.2）；接線前恆 not_generated。
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
});
