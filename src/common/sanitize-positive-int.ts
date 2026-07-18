/**
 * floor 後須為有限正整數，否則回退預設（防 0 致無限迴圈 / 並發 0）。共用於各 LLM 服務的 batchSize / concurrency
 * 等調參淨化（M12-C5：原 journey / custom-classify-assign / intent / topic-naming 各有一份、抽為單一來源）。
 */
export function sanitizePositiveInt(value: number | undefined, fallback: number): number {
  const floored = Math.floor(value ?? fallback);
  return Number.isFinite(floored) && floored >= 1 ? floored : fallback;
}
