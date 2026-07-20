/**
 * 品牌別名正規化聯集比對（T14.5，FR-40 / AC-40.3）——**純函式**，供 FR-42 品牌抽取（M15）比對 AI 回答中的品牌
 * 提及共用。以 `name + aliases` 聯集、經與去重/快取**同一套** `normalizeText`（S4）正規化後比對（如 `華碩→ASUS`）。
 *
 * ⚠ shell（T14.5 red）：尚未實作，先給 typed not-implemented 空殼讓測試「斷言紅」而非「編譯紅」。
 */

/** 比對所需的最小品牌面（name + aliases）；本品牌與競品皆適用。 */
export interface BrandAliasInput {
  name: string;
  aliases: string[];
}

export function normalizedAliasUnion(_brand: BrandAliasInput): Set<string> {
  throw new Error('not implemented: normalizedAliasUnion (T14.5)');
}

export function brandMatches(_mention: string, _brand: BrandAliasInput): boolean {
  throw new Error('not implemented: brandMatches (T14.5)');
}

export function findMatchingBrand<T extends BrandAliasInput>(
  _mention: string,
  _brands: readonly T[],
): T | null {
  throw new Error('not implemented: findMatchingBrand (T14.5)');
}
