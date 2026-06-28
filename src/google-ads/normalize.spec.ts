import { dedupeMerge, normalizeText } from './normalize';
import type { KeywordCandidate } from './keyword.types';

describe('normalizeText (TC-1)', () => {
  it('lowercases, trims, and collapses internal whitespace', () => {
    expect(normalizeText('  Hello   World  ')).toBe('hello world');
    expect(normalizeText('A\t\nB')).toBe('a b');
  });

  it('applies NFKC: full-width letters/digits fold to ASCII', () => {
    expect(normalizeText('ＫＥＹword')).toBe('keyword');
    expect(normalizeText('２０２４ 排名')).toBe('2024 排名');
  });

  it('folds the ideographic space (U+3000) via NFKC + whitespace collapse', () => {
    expect(normalizeText('咖啡　機')).toBe('咖啡 機');
  });

  it('is idempotent', () => {
    const once = normalizeText('  Café  Latte ');
    expect(normalizeText(once)).toBe(once);
  });
});

describe('dedupeMerge (TC-1)', () => {
  const seed = (text: string, hasMetrics = false): KeywordCandidate => ({
    text,
    source: 'seed',
    hasMetrics,
  });
  const expanded = (text: string, seedOrigins: string[], hasMetrics = true): KeywordCandidate => ({
    text,
    source: 'expanded',
    seedOrigins,
    hasMetrics,
  });

  it('produces no duplicate normalizedText', () => {
    const out = dedupeMerge([
      expanded('Coffee Maker', ['coffee']),
      expanded('coffee   maker', ['espresso']),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].normalizedText).toBe('coffee maker');
  });

  it('keeps the seed original text and marks the row source=seed when a seed collides with an expansion', () => {
    const out = dedupeMerge([seed('Coffee'), expanded('coffee', ['espresso'])]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('Coffee'); // seed 原字保留
    expect(out[0].source).toBe('seed');
  });

  it('prefers the entry carrying metrics when merging duplicates', () => {
    const out = dedupeMerge([seed('Coffee', false), expanded('coffee', ['espresso'], true)]);
    expect(out[0].hasMetrics).toBe(true);
  });

  it('always includes every seed, even with no matching expansion', () => {
    const out = dedupeMerge([seed('latte'), expanded('cold brew', ['coffee'])]);
    expect(out.map((k) => k.normalizedText).sort()).toEqual(['cold brew', 'latte']);
    const latte = out.find((k) => k.normalizedText === 'latte');
    expect(latte?.source).toBe('seed');
  });

  it('records the union of seedOrigins for a merged expanded keyword', () => {
    const out = dedupeMerge([
      expanded('Cold Brew', ['coffee']),
      expanded('cold brew', ['espresso', 'coffee']),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('expanded');
    expect(out[0].seedOrigins).toEqual(['coffee', 'espresso']);
  });

  it('keeps the metrics-bearing entry as the representative when two expansions collide', () => {
    // 第二筆才帶指標 → 代表列須採帶指標者（含其原字），對齊 AC-2.3「優先保留含 metrics 的那筆」。
    const out = dedupeMerge([
      expanded('cold brew', ['coffee'], false),
      expanded('Cold Brew', ['espresso'], true),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].hasMetrics).toBe(true);
    expect(out[0].text).toBe('Cold Brew'); // 帶指標者的原字成為代表
    expect(out[0].seedOrigins).toEqual(['coffee', 'espresso']);
  });

  it('preserves first-seen order of distinct keywords', () => {
    const out = dedupeMerge([seed('b'), seed('a'), expanded('c', ['x'])]);
    expect(out.map((k) => k.normalizedText)).toEqual(['b', 'a', 'c']);
  });

  it('uses the same normalizeText as the dedupe key (cache/dedupe parity)', () => {
    const out = dedupeMerge([expanded('ＣＯＦＦＥＥ', ['x']), expanded('coffee', ['y'])]);
    expect(out).toHaveLength(1);
    expect(out[0].normalizedText).toBe('coffee');
  });

  it('leaves seedOrigins undefined when neither colliding entry carries any', () => {
    const out = dedupeMerge([seed('Coffee'), seed('coffee')]);
    expect(out).toHaveLength(1);
    expect(out[0].seedOrigins).toBeUndefined();
  });

  it('carries seedOrigins across when only one colliding entry has them (seed wins on text/source)', () => {
    const out = dedupeMerge([seed('Coffee'), expanded('coffee', ['espresso'])]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('seed');
    expect(out[0].text).toBe('Coffee');
    expect(out[0].seedOrigins).toEqual(['espresso']);
  });

  it('lets a later seed override an earlier expanded row (seed wins regardless of order)', () => {
    const out = dedupeMerge([expanded('coffee', ['espresso']), seed('Coffee')]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('seed'); // seed 後到仍勝出
    expect(out[0].text).toBe('Coffee'); // 改用 seed 原字
    expect(out[0].seedOrigins).toEqual(['espresso']); // 保留 expanded 的來源
  });

  it('keeps the first seed text when two seeds collide without metrics (first-seen)', () => {
    const out = dedupeMerge([seed('Coffee'), seed('COFFEE')]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('Coffee'); // 同源、皆無指標 → 維持首見原字
    expect(out[0].source).toBe('seed');
  });

  it('prefers the metrics-bearing seed text when two seeds collide (AC-2.3)', () => {
    // AC-2.3「優先保留含 metrics 的那筆」為 tiebreaker，凌駕首見；normalizedText 相同，
    // 故去重/快取 key 不受影響，僅代表 text 改採帶指標者。
    const out = dedupeMerge([seed('Coffee'), seed('COFFEE', true)]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('COFFEE');
    expect(out[0].source).toBe('seed');
    expect(out[0].hasMetrics).toBe(true);
  });
});
