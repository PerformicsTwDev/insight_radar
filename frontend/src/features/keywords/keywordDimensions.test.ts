import { describe, expect, it } from 'vitest';
import {
  cellStateForRow,
  dimensionCellState,
  dimensionHeaderPhase,
  journeyStageByKey,
  topicLabelByKey,
} from './keywordDimensions';
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

describe('TC-28 · journeyStageByKey (normalizedText → stage zh label client-join, M7-R2c)', () => {
  it('maps each classified keyword to its stage zh label (via the resolveJourneyStage SSOT)', () => {
    const map = journeyStageByKey([
      { text: 'running shoes', normalizedText: 'running shoes', stage: 'spec_comparison' },
      { text: 'buy shoes', normalizedText: 'buy shoes', stage: 'final_decision' },
    ]);
    expect(map.get('running shoes')).toBe('規格比較');
    expect(map.get('buy shoes')).toBe('最終決策');
    expect(map.size).toBe(2);
  });

  it('omits rows with a missing / non-canonical stage (they render — , C12)', () => {
    const map = journeyStageByKey([
      { normalizedText: 'unstaged', stage: null },
      { normalizedText: 'bogus', stage: 'not_a_stage' },
      { normalizedText: 'ok', stage: 'pain_awareness' },
    ]);
    expect(map.has('unstaged')).toBe(false);
    expect(map.has('bogus')).toBe(false);
    expect(map.get('ok')).toBe('痛點覺察');
  });

  it('omits a row that carries no normalizedText join key (even with a valid stage)', () => {
    // A journey-view row missing normalizedText has no C7 key → it cannot be joined, so it is dropped
    // (never keyed by `undefined`); the map holds only the joinable row.
    const map = journeyStageByKey([
      { text: 'no key', stage: 'final_decision' },
      { text: 'keyed', normalizedText: 'keyed', stage: 'final_decision' },
    ]);
    expect(map.size).toBe(1);
    expect(map.get('keyed')).toBe('最終決策');
  });

  it('returns an empty map for undefined rows (journey not yet fetched)', () => {
    expect(journeyStageByKey(undefined).size).toBe(0);
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

  it('is a value pill for a classified keyword once ready+loaded, else — (empty)', () => {
    expect(dimensionCellState('ready', '規格探究')).toEqual({ kind: 'value', label: '規格探究' });
    expect(dimensionCellState('ready', undefined)).toEqual({ kind: 'empty' });
  });

  it('is a generating shimmer (not —) at ready while the result is still loading (M7-R15)', () => {
    // ready but the dimension query hasn't resolved → no label yet ≠ unclassified: show the shimmer,
    // never the definitive — (which would misread a classified keyword as having no topic/stage).
    expect(dimensionCellState('ready', undefined, false)).toEqual({ kind: 'generating' });
    // once loaded, a still-absent label IS a genuinely unclassified keyword → — (empty).
    expect(dimensionCellState('ready', undefined, true)).toEqual({ kind: 'empty' });
    // a label always wins (classified) regardless of the loaded flag.
    expect(dimensionCellState('ready', '規格探究', false)).toEqual({
      kind: 'value',
      label: '規格探究',
    });
  });

  it('is masked before generation (not_generated / failed)', () => {
    expect(dimensionCellState('not_generated', undefined)).toEqual({ kind: 'masked' });
    expect(dimensionCellState('failed', '規格探究')).toEqual({ kind: 'masked' });
  });
});

describe('TC-28 · cellStateForRow (normalizedText lookup → cell state, M7-R2b/c)', () => {
  const labels = new Map([['running shoes', '規格探究']]);

  it('looks the label up by normalizedText and derives a value pill when ready+loaded', () => {
    expect(cellStateForRow('ready', 'running shoes', labels, true)).toEqual({
      kind: 'value',
      label: '規格探究',
    });
  });

  it('is empty (—) at ready+loaded when the keyword is not in the joined map', () => {
    expect(cellStateForRow('ready', 'unknown kw', labels, true)).toEqual({ kind: 'empty' });
  });

  it('is a generating shimmer (not —) while the map is still loading (M7-R15)', () => {
    // Before the dimension query resolves, EVERY keyword is absent from the (empty) map — that must
    // read as loading, not unclassified.
    expect(cellStateForRow('ready', 'running shoes', new Map(), false)).toEqual({
      kind: 'generating',
    });
  });

  it('treats a row without a normalizedText join key as having no label (— / masked)', () => {
    expect(cellStateForRow('ready', undefined, labels, true)).toEqual({ kind: 'empty' });
    expect(cellStateForRow('not_generated', undefined, labels, true)).toEqual({ kind: 'masked' });
  });
});
