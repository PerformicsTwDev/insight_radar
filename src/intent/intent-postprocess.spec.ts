import { postProcessIntent } from './intent-postprocess';
import type { RawIntentBatch } from './intent-postprocess';

const batch = (results: RawIntentBatch['results']): RawIntentBatch => ({ results });

describe('postProcessIntent (TC-7)', () => {
  it('maps results back to inputs by keyword and keeps each input exactly once', () => {
    const out = postProcessIntent(
      ['coffee', 'best espresso machine'],
      batch([
        { keyword: 'best espresso machine', labels: ['commercial'] },
        { keyword: 'coffee', labels: ['informational'] },
      ]),
    );
    expect(out.map((r) => r.keyword)).toEqual(['coffee', 'best espresso machine']); // input order
    expect(out).toHaveLength(2);
  });

  it('de-duplicates labels', () => {
    const out = postProcessIntent(
      ['coffee'],
      batch([{ keyword: 'coffee', labels: ['informational', 'informational', 'commercial'] }]),
    );
    expect(out[0].labels).toEqual(['informational', 'commercial']);
  });

  it('fills a missing keyword with the fallback label informational', () => {
    const out = postProcessIntent(
      ['coffee', 'tea'],
      batch([{ keyword: 'coffee', labels: ['commercial'] }]), // tea missing
    );
    const tea = out.find((r) => r.keyword === 'tea');
    expect(tea?.labels).toEqual(['informational']);
  });

  it('matches results back via normalizedText (case/whitespace-insensitive)', () => {
    const out = postProcessIntent(
      ['Coffee Maker'],
      batch([{ keyword: 'coffee   maker', labels: ['commercial'] }]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].keyword).toBe('Coffee Maker'); // original input text preserved
    expect(out[0].labels).toEqual(['commercial']);
  });

  it('gives an empty-labels result the fallback informational (≥1 label guarantee)', () => {
    const out = postProcessIntent(['coffee'], batch([{ keyword: 'coffee', labels: [] }]));
    expect(out[0].labels).toEqual(['informational']);
  });

  it('drops results whose keyword is not an input (no hallucinated rows)', () => {
    const out = postProcessIntent(
      ['coffee'],
      batch([
        { keyword: 'coffee', labels: ['commercial'] },
        { keyword: 'unsolicited', labels: ['transactional'] },
      ]),
    );
    expect(out.map((r) => r.keyword)).toEqual(['coffee']);
  });

  it('ignores invalid label strings, falling back when none remain', () => {
    const out = postProcessIntent(
      ['coffee', 'tea'],
      batch([
        { keyword: 'coffee', labels: ['commercial', 'bogus'] },
        { keyword: 'tea', labels: ['nonsense'] },
      ]),
    );
    expect(out.find((r) => r.keyword === 'coffee')?.labels).toEqual(['commercial']);
    expect(out.find((r) => r.keyword === 'tea')?.labels).toEqual(['informational']); // all invalid → fallback
  });

  it('produces exactly one result per input even when parsed is empty', () => {
    const out = postProcessIntent(['a', 'b', 'c'], batch([]));
    expect(out.map((r) => r.keyword)).toEqual(['a', 'b', 'c']);
    for (const r of out) {
      expect(r.labels).toEqual(['informational']);
    }
  });

  it('uses the last result when the model emits a duplicate keyword', () => {
    const out = postProcessIntent(
      ['coffee'],
      batch([
        { keyword: 'coffee', labels: ['informational'] },
        { keyword: 'coffee', labels: ['transactional'] },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].labels).toEqual(['transactional']);
  });
});
