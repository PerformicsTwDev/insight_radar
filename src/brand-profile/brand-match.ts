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
 * 在一組品牌中找出第一個匹配該 mention 的品牌（無則 `null`）。品牌順序＝呼叫端優先序（本品牌先於競品）；
 * 供 FR-42 品牌抽取把 AI 回答中的品牌提及歸戶到已設定的 `BrandProfile`。
 */
export function findMatchingBrand<T extends BrandAliasInput>(
  mention: string,
  brands: readonly T[],
): T | null {
  const normalized = normalizeText(mention);
  if (normalized.length === 0) {
    return null;
  }
  for (const brand of brands) {
    if (normalizedAliasUnion(brand).has(normalized)) {
      return brand;
    }
  }
  return null;
}
