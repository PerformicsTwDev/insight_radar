import {
  extractRepresentatives,
  type ExtractRepresentativesInput,
  type RepresentativeInputKeyword,
} from './representatives';

/** 造一批對齊的關鍵字（avg 預設 null）。 */
function kw(text: string, avgMonthlySearches: number | null = null): RepresentativeInputKeyword {
  return { text, normalizedText: text, avgMonthlySearches };
}

describe('extractRepresentatives (T8.6 / TC-43)', () => {
  it('groups by label, excludes noise, sorts clusters ascending, counts noiseCount', () => {
    const input: ExtractRepresentativesInput = {
      labels: [2, 0, 0, -1],
      probabilities: [0.9, 0.8, 0.7, 0],
      keywords: [kw('a'), kw('b'), kw('c'), kw('n')],
    };

    const { clusters, noiseCount } = extractRepresentatives(input);

    expect(noiseCount).toBe(1);
    expect(clusters.map((c) => c.clusterLabel)).toEqual([0, 2]); // 升冪、排除 noise
    expect(clusters.find((c) => c.clusterLabel === 0)?.keywordCount).toBe(2);
    expect(clusters.find((c) => c.clusterLabel === 2)?.keywordCount).toBe(1);
  });

  it('orders representativeKeywords by probability descending', () => {
    const input: ExtractRepresentativesInput = {
      labels: [0, 0, 0],
      probabilities: [0.5, 0.9, 0.7],
      keywords: [kw('low'), kw('high'), kw('mid')],
    };

    const { clusters } = extractRepresentatives(input);

    expect(clusters[0].representativeKeywords.map((r) => r.text)).toEqual(['high', 'mid', 'low']);
    expect(clusters[0].representativeKeywords[0].probability).toBe(0.9);
  });

  it('respects the topK limit (default 20, overridable)', () => {
    const input: ExtractRepresentativesInput = {
      labels: [0, 0, 0],
      probabilities: [0.9, 0.8, 0.7],
      keywords: [kw('a'), kw('b'), kw('c')],
      topK: 2,
    };

    const { clusters } = extractRepresentatives(input);

    expect(clusters[0].representativeKeywords.map((r) => r.text)).toEqual(['a', 'b']); // 只前 2
    expect(clusters[0].keywordCount).toBe(3); // count 仍為全群
  });

  it('sums avgMonthlySearches for clusterVolume, skipping null (not zero-filled)', () => {
    const input: ExtractRepresentativesInput = {
      labels: [0, 0, 0],
      probabilities: [0.9, 0.8, 0.7],
      keywords: [kw('a', 100), kw('b', null), kw('c', 50)],
    };

    const { clusters } = extractRepresentatives(input);

    expect(clusters[0].clusterVolume).toBe(150); // 100 + 50，null 略過
  });

  it('returns clusterVolume null when every member avgMonthlySearches is null (no fabricated 0)', () => {
    const input: ExtractRepresentativesInput = {
      labels: [0, 0],
      probabilities: [0.9, 0.8],
      keywords: [kw('a', null), kw('b', null)],
    };

    const { clusters } = extractRepresentatives(input);

    expect(clusters[0].clusterVolume).toBeNull();
  });

  it('breaks probability ties by nearest-centroid cosine when vectors are given', () => {
    // 三字同群：high(0.9) 必為首；b/c 並列 0.8 → 以最靠質心 cosine 決勝。
    // vectors：b 與 high 同向（靠質心）、c 正交（遠）→ 順序 [high, b, c]。
    const input: ExtractRepresentativesInput = {
      labels: [0, 0, 0],
      probabilities: [0.9, 0.8, 0.8],
      keywords: [kw('high'), kw('b'), kw('c')],
      vectors: [
        [1, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
    };

    const { clusters } = extractRepresentatives(input);

    expect(clusters[0].representativeKeywords.map((r) => r.text)).toEqual(['high', 'b', 'c']);
  });

  it('falls back to original order when vectors give an equal cosine (identical vectors)', () => {
    const input: ExtractRepresentativesInput = {
      labels: [0, 0],
      probabilities: [0.8, 0.8],
      keywords: [kw('x'), kw('y')],
      vectors: [
        [1, 0],
        [1, 0], // 相同向量 → cosine 相等 → 退回原序
      ],
    };

    const { clusters } = extractRepresentatives(input);

    expect(clusters[0].representativeKeywords.map((r) => r.text)).toEqual(['x', 'y']);
  });

  it('treats a zero vector as cosine 0 (no NaN, ranks last among ties)', () => {
    // high(0.9) 首；b/c 並列 0.8：b 非零向量（cosine>0）、c 零向量（cosine 0）→ b 先於 c。
    const input: ExtractRepresentativesInput = {
      labels: [0, 0, 0],
      probabilities: [0.9, 0.8, 0.8],
      keywords: [kw('high'), kw('b'), kw('c')],
      vectors: [
        [1, 0],
        [1, 0],
        [0, 0], // 零向量
      ],
    };

    const { clusters } = extractRepresentatives(input);

    expect(clusters[0].representativeKeywords.map((r) => r.text)).toEqual(['high', 'b', 'c']);
  });

  it('keeps original order for probability ties when no vectors are provided (stable)', () => {
    const input: ExtractRepresentativesInput = {
      labels: [0, 0],
      probabilities: [0.8, 0.8],
      keywords: [kw('x'), kw('y')],
    };

    const { clusters } = extractRepresentatives(input);

    expect(clusters[0].representativeKeywords.map((r) => r.text)).toEqual(['x', 'y']);
  });

  it('carries the soft probability and avgMonthlySearches onto each representative', () => {
    const input: ExtractRepresentativesInput = {
      labels: [0],
      probabilities: [0.42],
      keywords: [{ text: 'kw', normalizedText: 'kw', avgMonthlySearches: 12 }],
    };

    const rep = extractRepresentatives(input).clusters[0].representativeKeywords[0];

    expect(rep).toEqual({
      text: 'kw',
      normalizedText: 'kw',
      probability: 0.42,
      avgMonthlySearches: 12,
    });
  });

  it('throws on labels/probabilities/keywords length mismatch', () => {
    expect(() =>
      extractRepresentatives({
        labels: [0, 0, 0],
        probabilities: [0.9, 0.8],
        keywords: [kw('a'), kw('b'), kw('c')],
      }),
    ).toThrow(/length mismatch/);
  });

  it('throws when vectors length does not align with labels', () => {
    expect(() =>
      extractRepresentatives({
        labels: [0, 0],
        probabilities: [0.9, 0.8],
        keywords: [kw('a'), kw('b')],
        vectors: [[1, 0]],
      }),
    ).toThrow(/vectors length/);
  });

  it('returns empty clusters and zero noise for empty input', () => {
    expect(extractRepresentatives({ labels: [], probabilities: [], keywords: [] })).toEqual({
      clusters: [],
      noiseCount: 0,
    });
  });

  it('returns no clusters when every keyword is noise', () => {
    const input: ExtractRepresentativesInput = {
      labels: [-1, -1, -1],
      probabilities: [0, 0, 0],
      keywords: [kw('a'), kw('b'), kw('c')],
    };

    const { clusters, noiseCount } = extractRepresentatives(input);

    expect(clusters).toEqual([]);
    expect(noiseCount).toBe(3);
  });
});
