import {
  buildTopicsResponse,
  type AssignmentRow,
  type TopicClusterRow,
  type TopicRunView,
} from './build-topics-response';

function run(over: Partial<TopicRunView> = {}): TopicRunView {
  return {
    id: 'run-1',
    snapshotId: 'snap-1',
    status: 'completed',
    progress: { phase: 'persist', percent: 100 },
    clusterCount: 2,
    noiseCount: 1,
    ...over,
  };
}

function cluster(
  clusterId: string,
  label: number,
  over: Partial<TopicClusterRow> = {},
): TopicClusterRow {
  return {
    clusterId,
    clusterLabel: label,
    topicName: `T${label}`,
    parentTopic: `P${label}`,
    intentLabel: 'commercial',
    topicType: 'head',
    reason: 'r',
    clusterVolume: 150n,
    keywordCount: 2,
    confidence: 0.8,
    representativeKeywords: [{ text: 'a', normalizedText: 'a', probability: 0.9 }],
    ...over,
  };
}

function assignment(
  normalizedText: string,
  clusterId: string | null,
  isNoise = clusterId === null,
): AssignmentRow {
  return { normalizedText, clusterId, confidence: isNoise ? 0 : 0.9, isNoise };
}

describe('buildTopicsResponse (T8.10b / TC-49)', () => {
  it('maps clusters and inherits topic/parent/intent onto each keyword', () => {
    const clusters = [
      cluster('c0', 0),
      cluster('c1', 1, { topicName: 'Coffee', intentLabel: 'transactional' }),
    ];
    const assignments = [assignment('a', 'c0'), assignment('b', 'c1')];
    const texts = new Map([
      ['a', 'Keyword A'],
      ['b', 'Keyword B'],
    ]);

    const res = buildTopicsResponse(run(), clusters, assignments, texts);

    expect(res.clusters).toHaveLength(2);
    expect(res.keywords[0]).toEqual({
      text: 'Keyword A',
      normalizedText: 'a',
      topicName: 'T0',
      parentTopic: 'P0',
      intentLabel: 'commercial',
      confidence: 0.9,
      isNoise: false,
    });
    expect(res.keywords[1]).toMatchObject({ topicName: 'Coffee', intentLabel: 'transactional' });
  });

  it('sets null topic fields for a noise keyword (clusterId null)', () => {
    const res = buildTopicsResponse(run(), [cluster('c0', 0)], [assignment('n', null)], new Map());

    expect(res.keywords[0]).toEqual({
      text: 'n',
      normalizedText: 'n',
      topicName: null,
      parentTopic: null,
      intentLabel: null,
      confidence: 0,
      isNoise: true,
    });
  });

  it('serializes BigInt clusterVolume to a number and preserves null', () => {
    const clusters = [
      cluster('c0', 0, { clusterVolume: 150n }),
      cluster('c1', 1, { clusterVolume: null }),
    ];
    const res = buildTopicsResponse(run(), clusters, [], new Map());

    expect(res.clusters[0].clusterVolume).toBe(150);
    expect(res.clusters[1].clusterVolume).toBeNull();
  });

  it('falls back to normalizedText when no original text is known', () => {
    const res = buildTopicsResponse(run(), [cluster('c0', 0)], [assignment('kw', 'c0')], new Map());
    expect(res.keywords[0].text).toBe('kw');
  });

  it('carries status, progress and meta (runId/snapshotId/counts)', () => {
    const res = buildTopicsResponse(
      run({ status: 'partial', clusterCount: 3, noiseCount: 7 }),
      [],
      [],
      new Map(),
    );

    expect(res.status).toBe('partial');
    expect(res.progress).toEqual({ phase: 'persist', percent: 100 });
    expect(res.meta).toEqual({
      runId: 'run-1',
      snapshotId: 'snap-1',
      clusterCount: 3,
      noiseCount: 7,
    });
  });

  it('leaves inherited fields null when an assignment references an unknown cluster', () => {
    // 防呆：assignment.clusterId 指向不在 clusters 的 id → 繼承 null（不炸）。
    const res = buildTopicsResponse(
      run(),
      [cluster('c0', 0)],
      [assignment('x', 'missing')],
      new Map(),
    );
    expect(res.keywords[0]).toMatchObject({ topicName: null, intentLabel: null, isNoise: false });
  });
});
