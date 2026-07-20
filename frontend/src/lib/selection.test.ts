import { describe, expect, it } from 'vitest';
import { normalizeSeed } from './aiIdeation';
import {
  dedupedSearchTermCount,
  expandToSearchTerms,
  selectionContext,
  selectionKey,
  toMemberItems,
  toggleSelection,
  type KeywordSelection,
  type SelectionItem,
  type TopicSelection,
} from './selection';

/**
 * TC-9 (unit, core; FR-19 / Design §13.4 C7) — the selection + dedupe pure helpers
 * behind the tracking-list bulk bar. The selection key is the canonical
 * `normalizedText` (the SAME `normalizeSeed` single point AI-ideation / cache / the
 * server use), so a keyword selected in two views under different case / width /
 * whitespace is one selection — never rowIdx (which drifts across filter / paging).
 * A topic row expands (flattens) into its member keywords and unions with the picked
 * keywords, deduped by `normalizedText`, so a member equal to a picked keyword counts
 * once. Egress mapping stays contract-shaped (keyword → text+geo+language, topic →
 * analysisId+topicName).
 */

const kw = (text: string, geo = 'TW', language = 'zh-TW'): KeywordSelection => ({
  kind: 'keyword',
  text,
  geo,
  language,
});

const topic = (
  topicName: string,
  members: string[],
  opts: { analysisId?: string; geo?: string; language?: string } = {},
): TopicSelection => ({
  kind: 'topic',
  analysisId: opts.analysisId ?? 'a1',
  topicName,
  geo: opts.geo ?? 'TW',
  language: opts.language ?? 'zh-TW',
  members,
});

describe('TC-9 · selectionKey (C7 normalizedText single point)', () => {
  it('keys a keyword by its normalizeSeed normalizedText', () => {
    expect(selectionKey(kw('Running Shoes'))).toBe(selectionKey(kw('  running   shoes ')));
  });

  it('collapses case / fullwidth / whitespace variants to one keyword key', () => {
    const key = selectionKey(kw('running shoes'));
    expect(selectionKey(kw('ＲＵＮＮＩＮＧ ＳＨＯＥＳ'))).toBe(key);
    expect(selectionKey(kw('running\t\nshoes'))).toBe(key);
  });

  it('does not collide a topic with a keyword of the same text', () => {
    expect(selectionKey(topic('running shoes', []))).not.toBe(selectionKey(kw('running shoes')));
  });

  it('scopes a topic key by its source analysisId (same name, different run → distinct)', () => {
    expect(selectionKey(topic('shoes', [], { analysisId: 'a1' }))).not.toBe(
      selectionKey(topic('shoes', [], { analysisId: 'a2' })),
    );
  });
});

describe('TC-9 · toggleSelection (accumulate across views, dedupe by key)', () => {
  it('adds an item that is not yet selected', () => {
    expect(toggleSelection([], kw('running shoes'))).toEqual([kw('running shoes')]);
  });

  it('accumulates distinct items picked across views', () => {
    const a = toggleSelection([], kw('running shoes'));
    const b = toggleSelection(a, kw('trail shoes'));
    expect(b).toEqual([kw('running shoes'), kw('trail shoes')]);
  });

  it('toggles OFF an item re-picked under a different case / width (same normalizedText)', () => {
    const selected = toggleSelection([], kw('running shoes'));
    // Re-pick the "same" keyword from another view (different casing) → removed, not doubled.
    expect(toggleSelection(selected, kw('RUNNING SHOES'))).toEqual([]);
  });

  it('does not drift when the same keyword appears at a different row (no rowIdx key)', () => {
    const selected = [kw('a'), kw('b'), kw('c')];
    // Re-toggle 'b' — removed regardless of its position.
    expect(toggleSelection(selected, kw('B'))).toEqual([kw('a'), kw('c')]);
  });
});

describe('TC-9 · expandToSearchTerms / dedupedSearchTermCount (topic flatten + union dedupe)', () => {
  it('dedupes picked keywords by normalizedText, order-stable', () => {
    const terms = expandToSearchTerms([
      kw('running shoes'),
      kw('RUNNING SHOES'),
      kw('trail shoes'),
    ]);
    expect(terms).toEqual([normalizeSeed('running shoes'), normalizeSeed('trail shoes')]);
  });

  it('flattens a topic row into its member keywords', () => {
    const terms = expandToSearchTerms([topic('shoes', ['running shoes', 'trail shoes'])]);
    expect(terms).toEqual([normalizeSeed('running shoes'), normalizeSeed('trail shoes')]);
  });

  it('unions topic members with picked keywords, counting an overlap once', () => {
    const items: SelectionItem[] = [
      kw('running shoes'),
      topic('shoes', ['Running Shoes', 'hiking boots']),
    ];
    // running shoes (kw) == Running Shoes (topic member) → 1; + hiking boots → 2.
    expect(dedupedSearchTermCount(items)).toBe(2);
    expect(expandToSearchTerms(items)).toEqual([
      normalizeSeed('running shoes'),
      normalizeSeed('hiking boots'),
    ]);
  });

  it('drops empty / whitespace-only members', () => {
    expect(expandToSearchTerms([topic('t', ['', '   ', 'real'])])).toEqual([normalizeSeed('real')]);
  });

  it('counts zero for an empty selection', () => {
    expect(dedupedSearchTermCount([])).toBe(0);
  });
});

describe('TC-9 · selectionContext (list-layer geo/language fixation)', () => {
  it('returns the shared geo/language when every item agrees', () => {
    expect(selectionContext([kw('a'), topic('t', ['x'])])).toEqual({
      geo: 'TW',
      language: 'zh-TW',
    });
  });

  it('returns null on a geo mismatch (cannot fix a new list layer)', () => {
    expect(selectionContext([kw('a', 'TW'), kw('b', 'US')])).toBeNull();
  });

  it('returns null on a language mismatch', () => {
    expect(selectionContext([kw('a', 'TW', 'zh-TW'), kw('b', 'TW', 'en')])).toBeNull();
  });

  it('returns null for an empty selection', () => {
    expect(selectionContext([])).toBeNull();
  });
});

describe('TC-9 · toMemberItems (AddMembersDto mapping, contract-shaped)', () => {
  it('maps a keyword to { kind, text, geo, language } (normalizedText derived server-side)', () => {
    expect(toMemberItems([kw('running shoes', 'TW', 'zh-TW')])).toEqual([
      { kind: 'keyword', text: 'running shoes', geo: 'TW', language: 'zh-TW' },
    ]);
  });

  it('maps a topic to { kind, analysisId, topicName } (server expands the latest run)', () => {
    expect(toMemberItems([topic('shoes', ['running shoes'], { analysisId: 'a7' })])).toEqual([
      { kind: 'topic', analysisId: 'a7', topicName: 'shoes' },
    ]);
  });

  it('maps a mixed selection preserving order', () => {
    expect(
      toMemberItems([kw('a', 'TW', 'zh-TW'), topic('t', ['x'], { analysisId: 'a1' })]),
    ).toEqual([
      { kind: 'keyword', text: 'a', geo: 'TW', language: 'zh-TW' },
      { kind: 'topic', analysisId: 'a1', topicName: 't' },
    ]);
  });
});
