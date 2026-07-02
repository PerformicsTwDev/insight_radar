import { MAX_EMBEDDING_TOKENS, buildEmbeddingInput } from './build-embedding-input';
import type { SerpContext } from './embedding.types';

const OPTS = { schemaVersion: 'v1' };

function serp(overrides: Partial<SerpContext> = {}): SerpContext {
  return {
    organic: [
      { title: 'Best coffee makers 2026', snippet: 'Our top picks for home brewing.' },
      { title: 'How to brew espresso', snippet: 'A step-by-step guide.' },
    ],
    peopleAlsoAsk: ['What is the best coffee?'],
    relatedSearches: ['coffee beans', 'coffee grinder'],
    ...overrides,
  };
}

describe('buildEmbeddingInput (T8.2 / TC-39)', () => {
  it('concatenates keyword + SERP titles/snippets + PAA + related', () => {
    const out = buildEmbeddingInput('coffee', serp(), OPTS);

    expect(out.hasSerp).toBe(true);
    expect(out.text).toContain('coffee');
    expect(out.text).toContain('Best coffee makers 2026');
    expect(out.text).toContain('Our top picks for home brewing.');
    expect(out.text).toContain('What is the best coffee?'); // PAA
    expect(out.text).toContain('coffee grinder'); // related
  });

  it('degrades to the pure keyword when SERP is absent (hasSerp=false)', () => {
    const out = buildEmbeddingInput('running shoes', undefined, OPTS);
    expect(out.hasSerp).toBe(false);
    expect(out.text).toBe('running shoes');
  });

  it('degrades to pure keyword when SERP is present but empty', () => {
    const out = buildEmbeddingInput('running shoes', { organic: [] }, OPTS);
    expect(out.hasSerp).toBe(false);
    expect(out.text).toBe('running shoes');
  });

  it('bounds a long latin input to the estimated token cap (~2048, ~4 chars/token)', () => {
    const bigSnippet = Array.from({ length: 20000 }, (_, i) => `w${i}`).join(' ');
    const out = buildEmbeddingInput(
      'coffee',
      { organic: [{ title: 't', snippet: bigSnippet }] },
      OPTS,
    );

    // 拉丁 ≈ 0.25 token/字 → 2048 tokens ≈ ~8192 字元；截斷後遠短於原文，且長度有界。
    expect(out.text.length).toBeLessThanOrEqual(MAX_EMBEDDING_TOKENS * 4 + 1);
    expect(out.text.length).toBeGreaterThan(1000); // 有實際內容（非空/未過度截斷）
  });

  it('truncates long CJK text — the whitespace-word approximation would never fire (M8-R1)', () => {
    // 中文無空白：舊 word 數近似把整段當 ~1 word → 永不截斷 → 爆 Gemini 2048 token 上限。新估以字元估 token。
    const longChinese = '關鍵字分析'.repeat(2000); // 10000 個 CJK 字 ≈ 10000 est tokens
    const out = buildEmbeddingInput(
      'coffee',
      { organic: [{ title: '標題', snippet: longChinese }] },
      OPTS,
    );

    // CJK ≈ 1 token/字 → 截到 ~2048 字元（含前綴 keyword/標題）。必須遠短於原 10000+ 字。
    expect(out.text.length).toBeLessThanOrEqual(MAX_EMBEDDING_TOKENS + 50);
    expect(out.text).toContain('關鍵字'); // 前段內容保留
  });

  it('respects an explicit topN, dropping later organic results', () => {
    const out = buildEmbeddingInput('coffee', serp(), { ...OPTS, topN: 1 });
    expect(out.text).toContain('Best coffee makers 2026'); // 1st kept
    expect(out.text).not.toContain('How to brew espresso'); // 2nd dropped
  });

  it('is stable: identical input yields an identical input_hash', () => {
    const a = buildEmbeddingInput('coffee', serp(), OPTS);
    const b = buildEmbeddingInput('coffee', serp(), OPTS);
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates the cache namespace by SERP presence (avoids pollution, TC-50)', () => {
    const withSerp = buildEmbeddingInput('coffee', serp(), OPTS);
    const pure = buildEmbeddingInput('coffee', undefined, OPTS);
    expect(withSerp.inputHash).not.toBe(pure.inputHash);
  });

  it('changes the input_hash when the schema version is bumped (整批失效)', () => {
    const v1 = buildEmbeddingInput('coffee', serp(), { schemaVersion: 'v1' });
    const v2 = buildEmbeddingInput('coffee', serp(), { schemaVersion: 'v2' });
    expect(v1.inputHash).not.toBe(v2.inputHash);
  });
});
