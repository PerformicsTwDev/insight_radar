import type { BrandAliasInput } from '../brand-profile/brand-match';
import {
  type BrandTextBlock,
  type RawBrandBatch,
  postProcessBrands,
} from './brand-extraction.postprocess';

/** 便利建構 id'd block（text 對 postProcess 無影響——LLM 已抽好 brands，此處只對回 + 正規化）。 */
const block = (id: string): BrandTextBlock => ({ id, text: `text-${id}` });

/** 目標品牌檔案（FR-40）：ASUS 別名含中文「華碩」/大小寫變體。 */
const asusProfile: BrandAliasInput[] = [{ name: 'ASUS', aliases: ['華碩', 'Asus'] }];

describe('TC-78: postProcessBrands (品牌抽取後處理——不去重=露出次數 + aliases 正規化)', () => {
  describe('S17 不去重＝露出次數（業務規則，不可「修正」為去重）', () => {
    it('同品牌在同一 block 出現多次 → 保留多次（＝露出次數，非去重）', () => {
      const parsed: RawBrandBatch = {
        results: [{ id: 'b0', brands: ['Apple', 'Apple', 'Apple'] }],
      };
      const out = postProcessBrands([block('b0')], parsed);
      // 真測「不去重」：三次露出必須是三筆，若被去重成 ['Apple'] 即紅。
      expect(out).toEqual([{ id: 'b0', brands: ['Apple', 'Apple', 'Apple'] }]);
    });

    it('同品牌跨多個 block 各自計數（每 block 的露出次數獨立保留）', () => {
      const parsed: RawBrandBatch = {
        results: [
          { id: 'b0', brands: ['Apple', 'Samsung'] },
          { id: 'b1', brands: ['Apple', 'Apple'] },
        ],
      };
      const out = postProcessBrands([block('b0'), block('b1')], parsed);
      expect(out).toEqual([
        { id: 'b0', brands: ['Apple', 'Samsung'] },
        { id: 'b1', brands: ['Apple', 'Apple'] },
      ]);
      // 全域露出次數 = 3 Apple + 1 Samsung（供 FR-43 mentions 加總，不去重）。
      const allBrands = out.flatMap((b) => b.brands);
      expect(allBrands.filter((b) => b === 'Apple')).toHaveLength(3);
    });

    it('正規化後同一品牌（不同別名）仍不去重——各別名各計一次露出', () => {
      const parsed: RawBrandBatch = {
        results: [{ id: 'b0', brands: ['華碩', 'ASUS', 'Asus'] }],
      };
      const out = postProcessBrands([block('b0')], parsed, asusProfile);
      // 三個提及全部正規化為 ASUS，但**不去重** → 三次露出。
      expect(out).toEqual([{ id: 'b0', brands: ['ASUS', 'ASUS', 'ASUS'] }]);
    });
  });

  describe('aliases 正規化（華碩→ASUS 以 BrandProfile.aliases，FR-40 純函式）', () => {
    it('中文別名 華碩 正規化為 canonical name ASUS', () => {
      const parsed: RawBrandBatch = { results: [{ id: 'b0', brands: ['華碩'] }] };
      const out = postProcessBrands([block('b0')], parsed, asusProfile);
      expect(out).toEqual([{ id: 'b0', brands: ['ASUS'] }]);
    });

    it('大小寫/空白變體經同一套 normalizeText 比對命中（Asus / " asus " → ASUS）', () => {
      const parsed: RawBrandBatch = {
        results: [{ id: 'b0', brands: ['Asus', ' asus '] }],
      };
      const out = postProcessBrands([block('b0')], parsed, asusProfile);
      expect(out).toEqual([{ id: 'b0', brands: ['ASUS', 'ASUS'] }]);
    });

    it('未命中任何 profile 別名的品牌保留原樣（競品/未追蹤品牌仍計入露出）', () => {
      const parsed: RawBrandBatch = {
        results: [{ id: 'b0', brands: ['華碩', 'Acer'] }],
      };
      const out = postProcessBrands([block('b0')], parsed, asusProfile);
      // 華碩→ASUS（命中）；Acer 未在 profile → 原樣保留（不丟棄）。
      expect(out).toEqual([{ id: 'b0', brands: ['ASUS', 'Acer'] }]);
    });

    it('多個 profile 品牌時，各提及歸戶到對應 canonical name', () => {
      const profile: BrandAliasInput[] = [
        { name: 'ASUS', aliases: ['華碩'] },
        { name: 'Acer', aliases: ['宏碁'] },
      ];
      const parsed: RawBrandBatch = {
        results: [{ id: 'b0', brands: ['華碩', '宏碁', '華碩'] }],
      };
      const out = postProcessBrands([block('b0')], parsed, profile);
      expect(out).toEqual([{ id: 'b0', brands: ['ASUS', 'Acer', 'ASUS'] }]);
    });
  });

  describe('未設 BrandProfile → 不硬崩（AC-40.3；demo/空品牌集）', () => {
    it('profileBrands 省略 → 品牌原樣回傳、不崩、不做正規化', () => {
      const parsed: RawBrandBatch = {
        results: [{ id: 'b0', brands: ['華碩', 'ASUS'] }],
      };
      expect(() => postProcessBrands([block('b0')], parsed)).not.toThrow();
      const out = postProcessBrands([block('b0')], parsed);
      // 無 profile → 無法把 華碩 正規化為 ASUS，原樣保留（不硬崩）。
      expect(out).toEqual([{ id: 'b0', brands: ['華碩', 'ASUS'] }]);
    });

    it('profileBrands 為空陣列 → 等同未設（matcher 永不命中）', () => {
      const parsed: RawBrandBatch = { results: [{ id: 'b0', brands: ['華碩'] }] };
      const out = postProcessBrands([block('b0')], parsed, []);
      expect(out).toEqual([{ id: 'b0', brands: ['華碩'] }]);
    });
  });

  describe('對回每個輸入 block + 部分失敗不污染他筆（驗證邊界）', () => {
    it('LLM 缺某 block 的結果 → 該 block 補空品牌集（不污染他筆、不崩）', () => {
      const parsed: RawBrandBatch = {
        results: [{ id: 'b1', brands: ['Apple'] }], // 缺 b0
      };
      const out = postProcessBrands([block('b0'), block('b1')], parsed);
      expect(out).toEqual([
        { id: 'b0', brands: [] }, // 缺漏 → 空（部分失敗不污染他筆，AC-42.5）
        { id: 'b1', brands: ['Apple'] },
      ]);
    });

    it('依輸入順序輸出、恰好每個 block 一列（含空品牌 block）', () => {
      const parsed: RawBrandBatch = {
        results: [
          { id: 'b2', brands: ['C'] },
          { id: 'b0', brands: ['A'] },
        ],
      };
      const out = postProcessBrands([block('b0'), block('b1'), block('b2')], parsed);
      expect(out.map((b) => b.id)).toEqual(['b0', 'b1', 'b2']);
      expect(out).toEqual([
        { id: 'b0', brands: ['A'] },
        { id: 'b1', brands: [] },
        { id: 'b2', brands: ['C'] },
      ]);
    });

    it('同一 block id 多筆結果 → 以最後一筆為準（沿用 intent last-wins）', () => {
      const parsed: RawBrandBatch = {
        results: [
          { id: 'b0', brands: ['Old'] },
          { id: 'b0', brands: ['New', 'New'] },
        ],
      };
      const out = postProcessBrands([block('b0')], parsed);
      expect(out).toEqual([{ id: 'b0', brands: ['New', 'New'] }]);
    });

    it('空白/空字串品牌被丟棄（驗證邊界；非真品牌不計露出），真品牌重複仍保留', () => {
      const parsed: RawBrandBatch = {
        results: [{ id: 'b0', brands: ['Apple', '', '   ', 'Apple'] }],
      };
      const out = postProcessBrands([block('b0')], parsed);
      expect(out).toEqual([{ id: 'b0', brands: ['Apple', 'Apple'] }]);
    });

    it('無 block（空輸入）→ 空輸出', () => {
      expect(postProcessBrands([], { results: [] })).toEqual([]);
    });
  });
});
