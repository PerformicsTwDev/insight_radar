import { normalizeText } from '../google-ads/normalize';

/**
 * 品牌別名正規化聯集比對（T14.5，FR-40 / AC-40.3）——**純函式**，供 FR-42 品牌抽取（M15）比對 AI 回答中的品牌
 * 提及共用。以 `name + aliases` 聯集、經與去重/快取**同一套** `normalizeText`（S4：NFKC → trim → collapse
 * whitespace → lowercase）正規化後比對（如 `華碩→ASUS`）——確保比對 key 與快取/去重 key 一致（正確性單點）。
 */

/** 比對所需的最小品牌面（name + aliases）；本品牌與競品皆適用。 */
export interface BrandAliasInput {
  name: string;
  aliases: string[];
}

/**
 * 品牌的正規化別名聯集（`name` + `aliases`）：各詞經 `normalizeText` 正規化，剔除正規化後為空者，去重成 Set
 * （O(1) 比對）。空聯集（name/aliases 皆空白）＝永不命中。
 */
export function normalizedAliasUnion(brand: BrandAliasInput): Set<string> {
  const union = new Set<string>();
  for (const term of [brand.name, ...brand.aliases]) {
    const normalized = normalizeText(term);
    if (normalized.length > 0) {
      union.add(normalized);
    }
  }
  return union;
}

/**
 * 某提及（mention）是否指向該品牌：對 mention 做同一套正規化後，是否落在品牌 `name`+`aliases` 的正規化聯集中
 * （如 `華碩` 命中 aliases 含 `華碩` 的 `ASUS`）。空提及（正規化後為空）→ 不命中。
 */
export function brandMatches(mention: string, brand: BrandAliasInput): boolean {
  const normalized = normalizeText(mention);
  return normalized.length > 0 && normalizedAliasUnion(brand).has(normalized);
}

/**
 * 預算式品牌比對器（M14-R7/#583 [9]）：對一組品牌**一次**算好各自的 normalizedAliasUnion，回傳可**重複**比對多個
 * mention 的閉包——避免每 mention 重建各 brand 的別名聯集 Set（供 FR-42 品牌抽取逐句掃描時對同一組品牌重用）。
 * 比對語意同 {@link findMatchingBrand}：回第一個命中的品牌（呼叫端優先序），空提及（正規化後為空）→ null。
 * prepared union 於建構時快照，之後改動來源陣列不影響已建立的比對器。
 */
export function createBrandMatcher<T extends BrandAliasInput>(
  brands: readonly T[],
): (mention: string) => T | null {
  const prepared = brands.map((brand) => ({ brand, union: normalizedAliasUnion(brand) }));
  return (mention: string): T | null => {
    const normalized = normalizeText(mention);
    if (normalized.length === 0) {
      return null;
    }
    for (const { brand, union } of prepared) {
      if (union.has(normalized)) {
        return brand;
      }
    }
    return null;
  };
}

/**
 * 在一組品牌中找出第一個匹配該 mention 的品牌（無則 `null`）。品牌順序＝呼叫端優先序（本品牌先於競品）；
 * 供 FR-42 品牌抽取把 AI 回答中的品牌提及歸戶到已設定的 `BrandProfile`。**單次**比對；逐句掃描多個 mention
 * 請改用 {@link createBrandMatcher} 一次預算、重複比對（避免每 mention 重建別名聯集）。
 */
export function findMatchingBrand<T extends BrandAliasInput>(
  mention: string,
  brands: readonly T[],
): T | null {
  return createBrandMatcher(brands)(mention);
}
