import { estimateLatency, type LatencyParams } from './latency-budget';

/** 標準工作量基準（NFR-1）：~50 seeds → ~2000 字、hit~0.4、batch 15、QPS 1、C_llm 6、K 30。 */
const CANONICAL: LatencyParams = {
  nSeeds: 50,
  batchSize: 15,
  qpsAds: 1,
  nKeywords: 2000,
  cacheHitRate: 0.4,
  kKwPerPrompt: 30,
  cLlm: 6,
  tPromptMs: 2000,
  tailMs: 2000,
};

describe('estimateLatency — pipeline latency budget (T4.5 / TC-27 / NFR-1)', () => {
  it('expand cost is the ~1 QPS Ads bottleneck: T_expand = ceil(seeds/batch) / QPS', () => {
    const e = estimateLatency({ ...CANONICAL });
    expect(e.nAdsRequests).toBe(Math.ceil(50 / 15)); // 4 批
    expect(e.tExpandMs).toBe((4 / 1) * 1000); // 4 請求 @ 1 QPS = 4000ms
  });

  it('only labels cache-miss keywords: N_llm_keywords = N · (1 - cacheHitRate)', () => {
    const e = estimateLatency({ ...CANONICAL });
    expect(e.nLlmKeywords).toBe(Math.round(2000 * (1 - 0.4))); // 1200
    expect(e.nLlmPrompts).toBe(Math.ceil(1200 / 30)); // 40

    // 命中率越高 → 貼標越少 → T_label 越短。
    const colder = estimateLatency({ ...CANONICAL, cacheHitRate: 0 });
    const warmer = estimateLatency({ ...CANONICAL, cacheHitRate: 0.8 });
    expect(warmer.nLlmKeywords).toBeLessThan(colder.nLlmKeywords);
    expect(warmer.tLabelMs).toBeLessThan(colder.tLabelMs);
  });

  it('label cost models C_llm concurrency + per-prompt round-trip', () => {
    const e = estimateLatency({ ...CANONICAL });
    expect(e.tLabelMs).toBe((40 / 6) * 2000); // (prompts / concurrency) · t_prompt
  });

  it('A/B overlap: T_total = max(T_expand, T_label) + tail (label-bound)', () => {
    const e = estimateLatency({ ...CANONICAL });
    // 標準工作量 label-bound（T_label > T_expand）。
    expect(e.tLabelMs).toBeGreaterThan(e.tExpandMs);
    expect(e.tTotalMs).toBe(Math.max(e.tExpandMs, e.tLabelMs) + 2000);
  });

  it('A/B overlap: expand-bound when Ads dominates (many seeds, fully cached labels)', () => {
    // 大量 seeds + 全命中（無貼標）→ T_expand 主導 → T_total = T_expand + tail。
    const e = estimateLatency({ ...CANONICAL, nSeeds: 600, cacheHitRate: 1 });
    expect(e.tLabelMs).toBe(0); // 全命中 → 不貼標
    expect(e.tExpandMs).toBeGreaterThan(e.tLabelMs);
    expect(e.tTotalMs).toBe(e.tExpandMs + 2000);
  });

  it('the canonical single-job workload stays under the 30s p95 budget (NFR-1)', () => {
    const e = estimateLatency({ ...CANONICAL });
    expect(e.tTotalMs).toBeLessThan(30_000);
  });
});
