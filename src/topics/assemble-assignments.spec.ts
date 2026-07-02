import {
  assembleAssignments,
  assembleClusterRecords,
  type AssignmentKeyword,
} from './assemble-assignments';
import type { ClusterNaming } from './topic-naming.postprocess';
import type { ClusterRepresentation, RepresentativeKeyword } from './representatives';

function rep(text: string, probability: number): RepresentativeKeyword {
  return { text, normalizedText: text, probability, avgMonthlySearches: null };
}

function representation(
  label: number,
  reps: RepresentativeKeyword[],
  over: Partial<ClusterRepresentation> = {},
): ClusterRepresentation {
  return {
    clusterLabel: label,
    keywordCount: reps.length,
    clusterVolume: 100,
    representativeKeywords: reps,
    ...over,
  };
}

function naming(label: number, over: Partial<ClusterNaming> = {}): ClusterNaming {
  return {
    clusterLabel: label,
    topicName: `Topic ${label}`,
    parentTopic: `Parent ${label}`,
    intentLabel: 'commercial',
    topicType: 'head',
    reason: 'r',
    degraded: false,
    ...over,
  };
}

function kw(normalizedText: string): AssignmentKeyword {
  return { normalizedText };
}

describe('assembleClusterRecords (T8.8 / TC-45)', () => {
  it('merges representatives + namings by clusterLabel', () => {
    const clusters = [representation(0, [rep('a', 0.9), rep('b', 0.7)])];
    const [record] = assembleClusterRecords(clusters, [naming(0, { topicName: 'Coffee' })]);

    expect(record).toMatchObject({
      clusterLabel: 0,
      topicName: 'Coffee',
      parentTopic: 'Parent 0',
      intentLabel: 'commercial',
      topicType: 'head',
      keywordCount: 2,
      clusterVolume: 100,
    });
    expect(record.representativeKeywords).toHaveLength(2);
  });

  it('sets cluster confidence to the mean representative probability', () => {
    const clusters = [representation(0, [rep('a', 0.8), rep('b', 0.6)])];
    const [record] = assembleClusterRecords(clusters, [naming(0)]);

    expect(record.confidence).toBeCloseTo(0.7);
  });

  it('null confidence when a cluster has no representatives', () => {
    const clusters = [representation(1, [], { keywordCount: 3 })];
    const [record] = assembleClusterRecords(clusters, [naming(1)]);

    expect(record.confidence).toBeNull();
  });

  it('preserves a null clusterVolume (not zero-filled)', () => {
    const clusters = [representation(0, [rep('a', 0.9)], { clusterVolume: null })];
    const [record] = assembleClusterRecords(clusters, [naming(0)]);

    expect(record.clusterVolume).toBeNull();
  });

  it('falls back safely when a cluster has no matching naming', () => {
    const clusters = [representation(2, [rep('espresso', 0.9)])];
    const [record] = assembleClusterRecords(clusters, []); // no naming for label 2

    expect(record).toMatchObject({
      topicName: 'espresso',
      intentLabel: 'informational',
      topicType: 'unknown',
    });
  });

  it('uses `cluster <label>` when there is neither a naming nor any representative', () => {
    const clusters = [representation(4, [], { keywordCount: 1 })];
    const [record] = assembleClusterRecords(clusters, []); // no naming, no reps

    expect(record.topicName).toBe('cluster 4');
    expect(record.confidence).toBeNull();
  });
});

describe('assembleAssignments (T8.8 / TC-45)', () => {
  it('produces exactly one row per input keyword, inheriting cluster naming', () => {
    const out = assembleAssignments(
      [0, 0, 1],
      [0.9, 0.8, 0.95],
      [kw('a'), kw('b'), kw('c')],
      [
        naming(0, { topicName: 'T0', intentLabel: 'transactional' }),
        naming(1, { topicName: 'T1' }),
      ],
    );

    expect(out).toHaveLength(3); // results 數 = 輸入字數
    expect(out[0]).toEqual({
      normalizedText: 'a',
      clusterLabel: 0,
      topicName: 'T0',
      parentTopic: 'Parent 0',
      intentLabel: 'transactional',
      confidence: 0.9,
      isNoise: false,
    });
    expect(out[2].topicName).toBe('T1'); // 由群 1 繼承
  });

  it('sets confidence to the soft probability of each keyword', () => {
    const out = assembleAssignments([0], [0.42], [kw('x')], [naming(0)]);
    expect(out[0].confidence).toBe(0.42);
  });

  it('marks label -1 as noise: null cluster/topic, isNoise true', () => {
    const out = assembleAssignments(
      [-1, 0],
      [0, 0.9],
      [kw('noise'), kw('real')],
      [naming(0, { topicName: 'Real' })],
    );

    expect(out[0]).toEqual({
      normalizedText: 'noise',
      clusterLabel: null,
      topicName: null,
      parentTopic: null,
      intentLabel: null,
      confidence: 0,
      isNoise: true,
    });
    expect(out[1]).toMatchObject({ clusterLabel: 0, topicName: 'Real', isNoise: false });
  });

  it('leaves inherited naming null when the cluster label has no naming', () => {
    const out = assembleAssignments([5], [0.7], [kw('x')], []); // no naming for label 5

    expect(out[0]).toMatchObject({
      clusterLabel: 5,
      topicName: null,
      intentLabel: null,
      isNoise: false,
    });
  });

  it('throws on labels/probabilities/keywords length mismatch', () => {
    expect(() => assembleAssignments([0, 0], [0.9], [kw('a'), kw('b')], [naming(0)])).toThrow(
      /length mismatch/,
    );
  });

  it('handles empty input and all-noise input', () => {
    expect(assembleAssignments([], [], [], [])).toEqual([]);

    const allNoise = assembleAssignments([-1, -1], [0, 0], [kw('a'), kw('b')], []);
    expect(allNoise.every((a) => a.isNoise && a.clusterLabel === null)).toBe(true);
  });
});
