import { microsToAmount, parseMicros } from './micros';

/**
 * Google Ads `keyword_idea_metrics`（= `KeywordPlanHistoricalMetrics`）的原始指標子集（Opteo camelCase）。
 * 對映 Design §4.1 指標映射表。
 */
export interface RawKeywordMetrics {
  avgMonthlySearches?: number | null;
  lowTopOfPageBidMicros?: string | number | null;
  highTopOfPageBidMicros?: string | number | null;
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
    avgMonthlySearches: raw.avgMonthlySearches ?? null,
    cpcLow: microsToAmount(raw.lowTopOfPageBidMicros),
    cpcHigh: microsToAmount(raw.highTopOfPageBidMicros),
    cpcLowMicros: toMicrosString(raw.lowTopOfPageBidMicros),
    cpcHighMicros: toMicrosString(raw.highTopOfPageBidMicros),
    currencyCode,
  };
}
