/**
 * Cache-first embedding 編排的**純函式核心**（T8.2c / M8-R9 · FR-16/NFR-13/TC-50）。
 * 從 {@link EmbeddingService} 抽出兩段 correctness-critical 邏輯——快取命中/未命中切分、以及依原索引回填
 * 對齊——以純函式獨立測試並掛 core-90%。索引一旦 off-by-one，embedding↔keyword 全表錯位（每個關鍵字拿到
 * 別人的向量），故不留在只受 global-85% 聚合門檻涵蓋的 DI 編排 shell 裡。
 */

/** cache-miss 切分：`missIndexes[k]` 為原陣列索引，`missTexts[k]` 為其待送 provider 的文字（順序對齊）。 */
export interface CacheMisses {
  missIndexes: number[];
  missTexts: string[];
}

/** 依快取結果切出 miss（保留原索引以便回填）；`cached[i] === undefined` ⇒ miss。 */
export function partitionCacheMisses(
  cached: readonly (number[] | undefined)[],
  texts: readonly string[],
): CacheMisses {
  const missIndexes: number[] = [];
  const missTexts: string[] = [];
  cached.forEach((vector, index) => {
    if (!vector) {
      missIndexes.push(index);
      missTexts.push(texts[index]);
    }
  });
  return { missIndexes, missTexts };
}

/**
 * 依原順序回填：hit 用快取向量，miss 依序取 `missVectors`（其順序＝{@link partitionCacheMisses} 回的
 * `missIndexes`）。`missVectors` 必與 `cached` 中 `undefined` 的數量、順序一一對齊。
 */
export function mergeCacheFirst(
  cached: readonly (number[] | undefined)[],
  missVectors: readonly number[][],
): number[][] {
  let missCursor = 0;
  return cached.map((vector) => vector ?? missVectors[missCursor++]);
}
