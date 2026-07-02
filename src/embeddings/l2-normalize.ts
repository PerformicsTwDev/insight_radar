/** gemini-embedding-001 原生全維（3072）：原生即單位長度（L2=1）→ 免手動 normalize。 */
export const GEMINI_NATIVE_DIM = 3072;

/**
 * L2 正規化（單位長度）。gemini 原生 3072 已為單位長度 → **不需**呼叫此函式；僅**截短 <3072**（如 768/1536）
 * 的輸出才需手動 normalize 後存/比對（Design §16 / TC-40）。零向量原樣回（避免除以 0 → NaN）。
 */
export function l2normalize(vector: number[]): number[] {
  let sumSq = 0;
  for (const v of vector) {
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  if (norm === 0) {
    return vector.slice();
  }
  return vector.map((v) => v / norm);
}
