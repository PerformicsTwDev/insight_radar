/**
 * `KeywordSeed.keywords` 官方 proto 硬上限 **20**（送出 >20 → `InvalidArgument`，不可重試）。
 * 任何切批結果都不得超過此值（Design §4.1、TC-2、正確性單點）。
 */
export const MAX_SEED_BATCH_SIZE = 20;

/** 預設批量（保守 15，預留邊界並降低單請求體積）。對齊 config `GOOGLE_ADS_SEED_BATCH_SIZE`。 */
export const DEFAULT_SEED_BATCH_SIZE = 15;

/** 指定模式 `generateKeywordHistoricalMetrics` 單請求 keywords 官方上限 **10,000**（Design §4.1b）。 */
export const MAX_HISTORICAL_BATCH_SIZE = 10000;

/** 指定模式預設批量（保守 1000，避 64MB 回應 / 逾時）。對齊 config `GOOGLE_ADS_HISTORICAL_BATCH_SIZE`。 */
export const DEFAULT_HISTORICAL_BATCH_SIZE = 1000;

/**
 * 將輸入切成每批 ≤ `cap` 的批次。`batchSize` clamp 至 `[1, cap]`，非有限值退回 `fallback`
 * （避免 `i += NaN` 靜默吞掉輸入）。保持輸入順序與內容。
 */
function chunk(items: string[], batchSize: number, cap: number, fallback: number): string[][] {
  const requested = Number.isFinite(batchSize) ? batchSize : fallback;
  const size = Math.min(Math.max(Math.floor(requested), 1), cap);
  const batches: string[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * 拓展模式 seed 切批（FR-2 / NFR-2，TC-2）。`batchSize` clamp 至 `[1, 20]`——即使呼叫端傳入
 * 過大值，**絕不**送出 >20 seed 的批（防 Google Ads `InvalidArgument`）。
 */
export function chunkSeeds(
  seeds: string[],
  batchSize: number = DEFAULT_SEED_BATCH_SIZE,
): string[][] {
  return chunk(seeds, batchSize, MAX_SEED_BATCH_SIZE, DEFAULT_SEED_BATCH_SIZE);
}

/**
 * 指定模式 keywords 切批（FR-13，TC-34）。`batchSize` clamp 至 `[1, 10,000]`，預設 1000。
 */
export function chunkHistorical(
  keywords: string[],
  batchSize: number = DEFAULT_HISTORICAL_BATCH_SIZE,
): string[][] {
  return chunk(keywords, batchSize, MAX_HISTORICAL_BATCH_SIZE, DEFAULT_HISTORICAL_BATCH_SIZE);
}
