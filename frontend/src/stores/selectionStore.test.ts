import { beforeEach, describe, expect, it } from 'vitest';
import { useSelectionStore } from './selectionStore';
import type { KeywordSelection } from '../lib/selection';

/**
 * TC-9 (unit; FR-19 / Design §71-72, C7) — the Zustand `selectionStore` that holds the
 * client-only bulk selection set keyed by `normalizedText`. It accumulates picks across
 * views (toggle on/off), never drifts on rowIdx, dedupes case/width variants to one, and
 * clears wholesale after a successful add.
 */

const kw = (text: string, geo = 'TW', language = 'zh-TW'): KeywordSelection => ({
  kind: 'keyword',
  text,
  geo,
  language,
});

beforeEach(() => {
  useSelectionStore.setState({ items: [] });
});

describe('TC-9 · selectionStore', () => {
  it('starts empty', () => {
    expect(useSelectionStore.getState().items).toEqual([]);
  });

  it('toggles an item into the set', () => {
    useSelectionStore.getState().toggle(kw('running shoes'));
    expect(useSelectionStore.getState().items).toEqual([kw('running shoes')]);
  });

  it('accumulates distinct picks made across views', () => {
    const s = useSelectionStore.getState();
    s.toggle(kw('running shoes'));
    s.toggle(kw('trail shoes'));
    expect(useSelectionStore.getState().items).toEqual([kw('running shoes'), kw('trail shoes')]);
  });

  it('dedupes a re-pick of the same normalizedText (different casing) → toggles OFF', () => {
    const s = useSelectionStore.getState();
    s.toggle(kw('running shoes'));
    s.toggle(kw('RUNNING SHOES'));
    expect(useSelectionStore.getState().items).toEqual([]);
  });

  it('clears the whole set (used after a successful add)', () => {
    const s = useSelectionStore.getState();
    s.toggle(kw('a'));
    s.toggle(kw('b'));
    s.clear();
    expect(useSelectionStore.getState().items).toEqual([]);
  });
});
