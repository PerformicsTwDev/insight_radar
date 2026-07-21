import { type BrandAliasInput, createBrandMatcher } from '../brand-profile/brand-match';

/** 一段 AI 回答 text block（合成 `id` + 餵 LLM 的文字）——品牌抽取的輸入單位。 */
export interface BrandTextBlock {
  id: string;
  text: string;
}

/** 單一 block 的品牌抽取結果（`brands` **刻意不去重**＝露出次數，S17）。 */
export interface BlockBrands {
  id: string;
  brands: string[];
}

/** LLM 品牌抽取的原始輸出形狀（**刻意寬鬆**：後處理為驗證邊界，brands 視為未驗證字串）。 */
export interface RawBrandBatch {
  results: Array<{ id: string; brands: string[] }>;
}

/**
 * 品牌抽取後處理（FR-42 / AC-42.1，TC-78）。純函式：把 LLM 每筆結果對回**每個**輸入 block（依 `id`），
 * 並以 `BrandProfile.aliases` 做別名正規化（`華碩→ASUS`）。
 *
 * **S17 業務規則（不可「修正」為去重）**：`brands` **刻意不去重**＝露出次數——同品牌（含正規化後同名）多次
 * 出現即多筆。供 FR-43 `mentions` 加總。
 *
 * - 別名正規化：以 `createBrandMatcher`（T14.5 純函式）對每個提及做 `name+aliases` 正規化聯集比對；命中 →
 *   取 profile canonical `name`；未命中 → 原樣保留（競品/未追蹤品牌仍計入露出）。`profileBrands` 空/未設 →
 *   matcher 永不命中、全部原樣保留（**不硬崩**，AC-40.3 demo/空品牌集）。
 * - 驗證邊界：空白/空字串提及丟棄（非真品牌、不計露出），真品牌重複保留。
 * - 每輸入 block 恰一列、依輸入順序；缺漏/降級 block 補空品牌集（**部分失敗不污染他筆**，AC-42.5）。
 * - 同 `id` 多筆結果以**最後一筆**為準（沿用 intent last-wins）。
 */
export function postProcessBrands(
  blocks: readonly BrandTextBlock[],
  parsed: RawBrandBatch,
  profileBrands: readonly BrandAliasInput[] = [],
): BlockBrands[] {
  const matchBrand = createBrandMatcher(profileBrands);
  // id → raw brands（後到覆蓋先到）。
  const byId = new Map<string, string[]>();
  for (const result of parsed.results) {
    byId.set(result.id, result.brands);
  }

  return blocks.map((block) => {
    const raw = byId.get(block.id) ?? [];
    const brands: string[] = [];
    for (const mention of raw) {
      if (mention.trim().length === 0) {
        continue; // 空白/空字串非真品牌，不計露出（驗證邊界）。
      }
      const matched = matchBrand(mention);
      // 命中 profile → canonical name；否則原樣保留。**不去重**：每個提及各推一筆（露出次數）。
      brands.push(matched ? matched.name : mention);
    }
    return { id: block.id, brands };
  });
}
