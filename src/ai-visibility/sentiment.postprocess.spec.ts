import {
  type RawSentimentBatch,
  type SentimentTextBlock,
  postProcessSentiment,
} from './sentiment.postprocess';

/** 便利建構 id'd block（text 對 postProcess 無影響——LLM 已判好情緒，此處只對回 + 清洗）。 */
const block = (id: string): SentimentTextBlock => ({ id, text: `text-${id}` });

describe('TC-78: postProcessSentiment (情緒後處理——褒貶各+1 不 collapse + partial 不污染)', () => {
  describe('S17 褒貶混合各+1（業務規則，不可「修正」為二選一/三分類）', () => {
    it('同段同時褒貶 → positive=1 且 negative=1（兩邊各+1，非 xor/二選一）', () => {
      const parsed: RawSentimentBatch = { results: [{ id: 'b0', positive: 1, negative: 1 }] };
      const out = postProcessSentiment([block('b0')], parsed);
      // 真測「不 collapse」：若實作誤加 xor/擇一 → 這裡會變 {1,0} 或 {0,1} 即紅。
      expect(out).toEqual([{ id: 'b0', positive: 1, negative: 1 }]);
    });

    it('純正面 → {1,0}；純負面 → {0,1}；無情緒 → {0,0}（各維度獨立）', () => {
      const parsed: RawSentimentBatch = {
        results: [
          { id: 'pos', positive: 1, negative: 0 },
          { id: 'neg', positive: 0, negative: 1 },
          { id: 'neu', positive: 0, negative: 0 },
        ],
      };
      const out = postProcessSentiment([block('pos'), block('neg'), block('neu')], parsed);
      expect(out).toEqual([
        { id: 'pos', positive: 1, negative: 0 },
        { id: 'neg', positive: 0, negative: 1 },
        { id: 'neu', positive: 0, negative: 0 },
      ]);
    });

    it('多筆混合皆保留雙邊——不因任何規則被縮成單邊', () => {
      const parsed: RawSentimentBatch = {
        results: [
          { id: 'm0', positive: 1, negative: 1 },
          { id: 'm1', positive: 1, negative: 1 },
        ],
      };
      const out = postProcessSentiment([block('m0'), block('m1')], parsed);
      expect(out.every((r) => r.positive === 1 && r.negative === 1)).toBe(true);
    });
  });

  describe('驗證邊界：raw 非 0/1 值清洗為 0/1（strict 僅 server 保證，此處清洗）', () => {
    it('非 1 的雜訊值 → 0；1 → 1（各維度獨立 clamp，不互相影響）', () => {
      const parsed: RawSentimentBatch = {
        results: [{ id: 'b0', positive: 2, negative: 1 }],
      };
      const out = postProcessSentiment([block('b0')], parsed);
      expect(out).toEqual([{ id: 'b0', positive: 0, negative: 1 }]);
    });
  });

  describe('對回每個輸入 block + partial 不污染他筆（AC-42.5）', () => {
    it('LLM 缺某 block → 該 block 補 {0,0}（不污染他筆、不崩）', () => {
      const parsed: RawSentimentBatch = { results: [{ id: 'b1', positive: 1, negative: 1 }] };
      const out = postProcessSentiment([block('b0'), block('b1')], parsed);
      expect(out).toEqual([
        { id: 'b0', positive: 0, negative: 0 }, // 缺漏 → 補 {0,0}（AC-42.5）
        { id: 'b1', positive: 1, negative: 1 },
      ]);
    });

    it('依輸入順序輸出、恰每 block 一列（含補值 block）', () => {
      const parsed: RawSentimentBatch = {
        results: [
          { id: 'b2', positive: 1, negative: 0 },
          { id: 'b0', positive: 0, negative: 1 },
        ],
      };
      const out = postProcessSentiment([block('b0'), block('b1'), block('b2')], parsed);
      expect(out.map((r) => r.id)).toEqual(['b0', 'b1', 'b2']);
      expect(out).toEqual([
        { id: 'b0', positive: 0, negative: 1 },
        { id: 'b1', positive: 0, negative: 0 },
        { id: 'b2', positive: 1, negative: 0 },
      ]);
    });

    it('同 block id 多筆結果 → 以最後一筆為準（沿用 intent last-wins）', () => {
      const parsed: RawSentimentBatch = {
        results: [
          { id: 'b0', positive: 1, negative: 0 },
          { id: 'b0', positive: 1, negative: 1 },
        ],
      };
      const out = postProcessSentiment([block('b0')], parsed);
      expect(out).toEqual([{ id: 'b0', positive: 1, negative: 1 }]);
    });

    it('無 block（空輸入）→ 空輸出', () => {
      expect(postProcessSentiment([], { results: [] })).toEqual([]);
    });
  });
});
