import type { ClusterToName } from './topic-naming.prompt';
import {
  cleanTopicIntent,
  reconcileClusterNamings,
  type RawTopicNaming,
} from './topic-naming.postprocess';

function cluster(label: number, reps: string[] = [`kw${label}`]): ClusterToName {
  return {
    clusterLabel: label,
    representativeKeywords: reps,
    clusterVolume: null,
    keywordCount: reps.length,
  };
}

function topic(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    topic_name: 'Coffee Beans',
    parent_topic: 'Coffee',
    intent_label: 'commercial',
    topic_type: 'head',
    reason: 'buying signals',
    ...over,
  };
}

describe('cleanTopicIntent (T8.7 / TC-44)', () => {
  it('passes through the 4 valid intent labels', () => {
    for (const label of ['informational', 'commercial', 'transactional', 'navigational']) {
      expect(cleanTopicIntent(label)).toBe(label);
    }
  });

  it('falls back to informational for invalid or non-string labels', () => {
    expect(cleanTopicIntent('buy-now')).toBe('informational');
    expect(cleanTopicIntent(undefined)).toBe('informational');
    expect(cleanTopicIntent(42)).toBe('informational');
  });
});

describe('reconcileClusterNamings (T8.7 / TC-44)', () => {
  it('maps matched-count topics onto clusters in order (not degraded)', () => {
    const clusters = [cluster(0), cluster(1)];
    const parsed: RawTopicNaming = {
      topics: [
        topic({ topic_name: 'A' }),
        topic({ topic_name: 'B', intent_label: 'transactional' }),
      ],
    };

    const out = reconcileClusterNamings(clusters, parsed);

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      clusterLabel: 0,
      topicName: 'A',
      intentLabel: 'commercial',
      degraded: false,
    });
    expect(out[1]).toMatchObject({
      clusterLabel: 1,
      topicName: 'B',
      intentLabel: 'transactional',
      degraded: false,
    });
  });

  it('cleans an invalid intent_label to informational without marking degraded', () => {
    const out = reconcileClusterNamings([cluster(0)], {
      topics: [topic({ intent_label: 'nonsense' })],
    });

    expect(out[0].intentLabel).toBe('informational');
    expect(out[0].degraded).toBe(false);
  });

  it('fills defaults for non-string parent_topic / topic_type / reason', () => {
    const out = reconcileClusterNamings([cluster(0)], {
      topics: [topic({ parent_topic: 5, topic_type: '', reason: null })],
    });

    expect(out[0]).toMatchObject({ parentTopic: '', topicType: 'unknown', reason: '' });
  });

  it('falls back the whole batch on a count mismatch (cannot safely align)', () => {
    const clusters = [cluster(0), cluster(1)];
    const out = reconcileClusterNamings(clusters, { topics: [topic()] }); // 1 topic for 2 clusters

    expect(out.every((c) => c.degraded)).toBe(true);
    expect(out[0].reason).toContain('count mismatch');
  });

  it('falls back the whole batch when parsed is null (refusal/filter/malformed)', () => {
    const out = reconcileClusterNamings([cluster(0)], null, 'refusal');

    expect(out[0].degraded).toBe(true);
    expect(out[0].reason).toContain('refusal');
  });

  it('falls back an individual entry with a missing/blank topic_name (matched count)', () => {
    const clusters = [cluster(0), cluster(1)];
    const out = reconcileClusterNamings(clusters, {
      topics: [topic({ topic_name: '  ' }), topic({ topic_name: 'Good' })],
    });

    expect(out[0].degraded).toBe(true);
    expect(out[1]).toMatchObject({ topicName: 'Good', degraded: false });
  });

  it('uses the first representative keyword as the fallback topic name', () => {
    const out = reconcileClusterNamings([cluster(7, ['espresso machine', 'grinder'])], null);

    expect(out[0].topicName).toBe('espresso machine');
  });

  it('uses `cluster <label>` when a fallback cluster has no representatives', () => {
    const out = reconcileClusterNamings([cluster(9, [])], null);

    expect(out[0].topicName).toBe('cluster 9');
  });

  it('returns [] for no clusters', () => {
    expect(reconcileClusterNamings([], { topics: [] })).toEqual([]);
  });
});
