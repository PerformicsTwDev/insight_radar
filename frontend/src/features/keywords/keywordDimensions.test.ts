import { describe, expect, it } from 'vitest';
import { dimensionCellState, dimensionHeaderPhase, topicLabelByKey } from './keywordDimensions';
import type { TopicsResponse } from '../../api/topics';

/**
 * TC-28 (FR-18) — pure derivation for the on-demand dimension columns. The client-join keys on
 * `normalizedText` (C7 / D2); noise / null-topic keywords carry no pill (→ — via `empty`). Gate
 * status drives the header phase + per-cell state (masked → generating → value/empty).
 */

function topicsWith(keywords: TopicsResponse['keywords']): TopicsResponse {
  return {
    status: 'completed',
    progress: null,
    clusters: [],
    keywords,
    meta: { runId: 'r', snapshotId: 's', clusterCount: 1, noiseCount: 0 },
  };
}

const kw = (
  normalizedText: string,
  topicName: string | null,
  isNoise = false,
): TopicsResponse['keywords'][number] => ({
  text: normalizedText,
  normalizedText,
  topicName,
  parentTopic: null,
  intentLabel: null,
  confidence: 1,
  isNoise,
});

describe('TC-28 · topicLabelByKey (normalizedText → topicName client-join, M7-R2b)', () => {
  it('maps each classified keyword by its normalizedText', () => {
    const map = topicLabelByKey(
      topicsWith([kw('running shoes', '規格探究'), kw('cheap shoes', '促銷尋找')]),
    );
    expect(map.get('running shoes')).toBe('規格探究');
    expect(map.get('cheap shoes')).toBe('促銷尋找');
    expect(map.size).toBe(2);
  });

  it('omits noise + null-topic keywords (they render — , never a fabricated pill)', () => {
    const map = topicLabelByKey(
      topicsWith([kw('noise kw', '規格探究', true), kw('untopiced', null), kw('ok', '品牌比較')]),
    );
    expect(map.has('noise kw')).toBe(false);
    expect(map.has('untopiced')).toBe(false);
    expect(map.get('ok')).toBe('品牌比較');
  });

  it('returns an empty map when topics are undefined (not yet fetched)', () => {
    expect(topicLabelByKey(undefined).size).toBe(0);
  });
});

describe('TC-28 · dimensionHeaderPhase (gate status → header phase, M7-R2b)', () => {
  it('maps running → generating, ready → ready, and not_generated / failed → generatable', () => {
    expect(dimensionHeaderPhase('running')).toBe('generating');
    expect(dimensionHeaderPhase('ready')).toBe('ready');
    expect(dimensionHeaderPhase('not_generated')).toBe('generatable');
    expect(dimensionHeaderPhase('failed')).toBe('generatable'); // offer a retry
  });
});

describe('TC-28 · dimensionCellState (gate status + label → cell state, M7-R2b)', () => {
  it('is generating while the dimension job runs (regardless of any stale label)', () => {
    expect(dimensionCellState('running', undefined)).toEqual({ kind: 'generating' });
  });

  it('is a value pill for a classified keyword once ready, else — (empty)', () => {
    expect(dimensionCellState('ready', '規格探究')).toEqual({ kind: 'value', label: '規格探究' });
    expect(dimensionCellState('ready', undefined)).toEqual({ kind: 'empty' });
  });

  it('is masked before generation (not_generated / failed)', () => {
    expect(dimensionCellState('not_generated', undefined)).toEqual({ kind: 'masked' });
    expect(dimensionCellState('failed', '規格探究')).toEqual({ kind: 'masked' });
  });
});
