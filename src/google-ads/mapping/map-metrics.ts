import { microsToAmount, parseMicros } from './micros';

/**
 * Google Ads `keyword_idea_metrics`（= `KeywordPlanHistoricalMetrics`）的原始指標子集。
 * **snake_case**，對齊真實 gRPC 回應（gax `longs:String` → int64 為字串）。對映 Design §4.1 指標映射表。
 */
export interface RawKeywordMetrics {
  avg_monthly_searches?: number | string | null;
  low_top_of_page_bid_micros?: string | number | null;
  high_top_of_page_bid_micros?: string | number | null;
}

/** 映射後的指標（Design §5.1 Keyword 子集；competition/monthlyVolumes 由 T1.4/T1.5 補上）。 */
export interface MappedMetrics {
  avgMonthlySearches: number | null;
  cpcLow: number | null;
  cpcHigh: number | null;
  cpcLowMicros: string | null;
  cpcHighMicros: string | null;
  currencyCode: string;
}

/** 將 micros 正規化為 bigint-as-string（保留原值）；未設值 → null（與 microsToAmount 同一解析）。 */
function toMicrosString(micros: string | number | null | undefined): string | null {
  return parseMicros(micros)?.toString() ?? null;
}

/** 解析 int64-as-string 的計數（搜量）；未設值/空白/非有限 → null（不補 0）。 */
function toCount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 映射搜量 / CPC 指標（FR-3、TC-3）。
 *
 * - `cpcLow/High = micros ÷ 1,000,000`；**任一 micros 缺值 → 對應 cpc 為 null（不補 0）**。
 * - 保留原始 micros 為 bigint-as-string（`cpc*Micros`）。
 * - `avgMonthlySearches` 缺值 → null（純量，非趨勢；不補 0）。
 * - 帶帳戶 `currencyCode`。
 */
export function mapMetrics(raw: RawKeywordMetrics, currencyCode: string): MappedMetrics {
  return {
    avgMonthlySearches: toCount(raw.avg_monthly_searches),
    cpcLow: microsToAmount(raw.low_top_of_page_bid_micros),
    cpcHigh: microsToAmount(raw.high_top_of_page_bid_micros),
    cpcLowMicros: toMicrosString(raw.low_top_of_page_bid_micros),
    cpcHighMicros: toMicrosString(raw.high_top_of_page_bid_micros),
    currencyCode,
  };
}
