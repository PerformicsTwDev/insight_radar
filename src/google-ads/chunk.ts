/**
 * `KeywordSeed.keywords` 官方 proto 硬上限 **20**（送出 >20 → `InvalidArgument`，不可重試）。
 * 任何切批結果都不得超過此值（Design §4.1、TC-2、正確性單點）。
 */
export const MAX_SEED_BATCH_SIZE = 20;

/** 預設批量（保守 15，預留邊界並降低單請求體積）。對齊 config `GOOGLE_ADS_SEED_BATCH_SIZE`。 */
export const DEFAULT_SEED_BATCH_SIZE = 15;

/**
 * 將 seeds 切成每批 ≤ 20 的批次（FR-2 / NFR-2，TC-2）。
 *
 * `batchSize` clamp 至 `[1, MAX_SEED_BATCH_SIZE]`——即使呼叫端傳入過大值，**絕不**送出 >20 seed
 * 的批（防 Google Ads `InvalidArgument`）。保持輸入順序與內容。
 */
export function chunkSeeds(
  seeds: string[],
  batchSize: number = DEFAULT_SEED_BATCH_SIZE,
): string[][] {
  const size = Math.min(Math.max(Math.floor(batchSize), 1), MAX_SEED_BATCH_SIZE);
  const batches: string[][] = [];
  for (let i = 0; i < seeds.length; i += size) {
    batches.push(seeds.slice(i, i + size));
  }
  return batches;
}
