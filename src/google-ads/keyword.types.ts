/**
 * GoogleAds 拓展/去重的關鍵字領域型別（M1）。
 *
 * 對映 Design §5.1「Keyword（canonical / snapshot row 共用結構）」的子集。
 */

import type { CompetitionLevel } from './mapping/map-competition';
import type { MonthlySearchVolume } from './mapping/map-monthly-volumes';

/** 來源：`seed`（使用者原字，一律納入並標記）／`expanded`（拓展字）。 */
export type KeywordSource = 'seed' | 'expanded';

/** 映射後的指標載荷（Design §4.1 指標映射；缺指標時為 undefined）。 */
export interface KeywordMetrics {
  avgMonthlySearches: number | null;
  competition: CompetitionLevel;
  competitionIndex: number | null;
  cpcLow: number | null;
  cpcHigh: number | null;
  cpcLowMicros: string | null;
  cpcHighMicros: string | null;
  currencyCode: string;
  monthlyVolumes: MonthlySearchVolume[];
}

/**
 * 去重前的候選字（拓展回應或使用者輸入的單筆）。
 * - `metrics`：此筆映射後的指標；合併同字時偏好保留**有指標**者（FR-2 / AC-2.3）。
 * - `seedOrigins`：expanded 專用——此拓展字來自哪些 seed 的 `normalizedText`。
 */
export interface KeywordCandidate {
  text: string;
  source: KeywordSource;
  metrics?: KeywordMetrics;
  seedOrigins?: string[];
}

/** 去重後的關鍵字：附 `normalizedText`（去重 + 快取共用 key）。 */
export interface DedupedKeyword extends KeywordCandidate {
  normalizedText: string;
}

/**
 * 最終關鍵字列（Design §5.1 canonical / snapshot row 子集；指標欄位**攤平**）。
 * 缺指標時 cpc/competition/avgMonthlySearches 為 null、monthlyVolumes 為空陣列。
 */
export interface Keyword {
  text: string;
  normalizedText: string;
  source: KeywordSource;
  seedOrigins?: string[];
  avgMonthlySearches: number | null;
  competition: CompetitionLevel;
  competitionIndex: number | null;
  cpcLow: number | null;
  cpcHigh: number | null;
  cpcLowMicros: string | null;
  cpcHighMicros: string | null;
  currencyCode: string | undefined;
  monthlyVolumes: MonthlySearchVolume[];
}
