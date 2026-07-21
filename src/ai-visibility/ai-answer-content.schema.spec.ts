import { aiOverviewSchema, aiReferenceSchema, aiTextBlockSchema } from './ai-answer-content.schema';
import twoBrush from './__fixtures__/ai-overview-two-brush.sample.json';
import phones from './__fixtures__/ai-overview-phones.sample.json';

/**
 * TC-78 (部分) / NFR-19 — 回歸測試守 prompt 資產：以 brand_intent_radar 現成樣本（`src/data/*.json`，該專案零測試）
 * 對搬移的 Zod 輸入契約做斷言。樣本＝真實 Google AI Overview 抓取（text_blocks + references），與本專案 M14
 * `AiSearchCanonical{blocks,references}` / `AiReference` 同形；上游漂移（欄位缺/型別變）即紅燈。
 */
describe('TC-78: AI answer content input schema (regression against brand_intent_radar samples)', () => {
  it('parses the two-brush AI Overview sample (nested list blocks + references)', () => {
    for (const item of twoBrush) {
      expect(() => aiOverviewSchema.parse(item.ai_overview)).not.toThrow();
    }
  });

  it('parses the phones AI Overview sample (array root, real reference links)', () => {
    for (const item of phones) {
      const parsed = aiOverviewSchema.parse(item.ai_overview);
      expect(Array.isArray(parsed.text_blocks)).toBe(true);
      expect(Array.isArray(parsed.references)).toBe(true);
      expect(parsed.references.length).toBeGreaterThan(0);
    }
  });

  it('validates every reference across both samples against aiReferenceSchema', () => {
    const refs = [...twoBrush, ...phones].flatMap((i) => i.ai_overview.references);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(() => aiReferenceSchema.parse(ref)).not.toThrow();
    }
  });

  it('accepts recursive list text-blocks (heading / paragraph / nested list)', () => {
    const heading = { type: 'heading', snippet: '優點 (Pros)' };
    const nested = {
      type: 'list',
      list: [{ snippet: 'a', list: [{ snippet: 'a1' }] }],
      reference_indexes: [0, 1],
    };
    expect(() => aiTextBlockSchema.parse(heading)).not.toThrow();
    expect(() => aiTextBlockSchema.parse(nested)).not.toThrow();
  });

  it('tolerates additive upstream fields (drift guard is type/shape, not exact-match)', () => {
    expect(() =>
      aiReferenceSchema.parse({
        title: 't',
        link: 'https://x.tw',
        index: 0,
        newUpstreamField: 'ignored',
      }),
    ).not.toThrow();
  });

  it('rejects drift: wrong-typed or missing core reference fields', () => {
    expect(() => aiReferenceSchema.parse({ title: 't', link: 123, index: 0 })).toThrow();
    expect(() => aiReferenceSchema.parse({ title: 't', index: 0 })).toThrow(); // missing link
    expect(() => aiReferenceSchema.parse({ title: 't', link: 'u', index: 'zero' })).toThrow();
  });
});
