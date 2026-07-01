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

  it('truncates the assembled input to the token cap (~2048)', () => {
    const bigSnippet = Array.from({ length: 5000 }, (_, i) => `w${i}`).join(' ');
    const out = buildEmbeddingInput(
      'coffee',
      { organic: [{ title: 't', snippet: bigSnippet }] },
      OPTS,
    );

    const tokenCount = out.text.split(/\s+/).filter(Boolean).length;
    expect(tokenCount).toBe(MAX_EMBEDDING_TOKENS);
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
