import type { MonthlySearchVolume } from '../google-ads/mapping/map-monthly-volumes';

/**
 * 趨勢月份對齊 helper（T5.3，FR-5，TC-6；Design §9.2）。對**已篩選**的列（含 `monthlyVolumes`）：
 * union 月軸 → 整體加總 series（缺月補 0、`null` 不計入）→ top-N 個別 series（缺月/`null` 補 null，斷點）。
 * **不得**用純量 `avgMonthlySearches` 充當趨勢——趨勢一律由逐月 `monthlyVolumes` 組成。
 */

/** buildTrend 作用的列（snapshot `Keyword` 列子集；`Keyword` 結構上滿足）。 */
export interface TrendRow {
  text: string;
  normalizedText: string;
  avgMonthlySearches: number | null;
  monthlyVolumes: MonthlySearchVolume[];
}

export interface TrendSeries {
  /** 該列 `text`（顯示用）。 */
  keyword: string;
  /** 對齊 `axis`；缺月或該月 `searches=null` → `null`（斷點，不補 0）。 */
  points: (number | null)[];
}

export interface TrendResult {
  /** 月軸 `'YYYY-MM'` 升冪（各列 (year,month) 之聯集）。 */
  axis: string[];
  /** 整體加總 series，對齊 `axis`；該月 `null` 不計入、全無資料 → 0。 */
  total: number[];
  /** top-N 個別關鍵字 series（依 `avgMonthlySearches` desc、`normalizedText` asc tie-break、null 置尾）。 */
  series: TrendSeries[];
}

const DEFAULT_TOP_N = 10;

/** `(year, month)` → `'YYYY-MM'`（month 已名稱映射 1–12；補零使字典序＝時序）。 */
function monthKey(v: MonthlySearchVolume): string {
  return `${v.year}-${String(v.month).padStart(2, '0')}`;
}

/** 依 `avgMonthlySearches` desc 取 top-N；`null` 置尾、`normalizedText` asc tie-break（確定性）。 */
function rankTopN(rows: TrendRow[], topN: number): TrendRow[] {
  const sorted = [...rows].sort((a, b) => {
    const av = a.avgMonthlySearches;
    const bv = b.avgMonthlySearches;
    if (av !== bv) {
      if (av === null) {
        return 1; // null 置尾
      }
      if (bv === null) {
        return -1;
      }
      return bv - av; // desc
    }
    // 相等（含兩者皆 null）→ normalizedText asc
    return a.normalizedText < b.normalizedText ? -1 : 1;
  });
  return sorted.slice(0, Math.max(0, topN));
}

/** {@link TrendResult}：union 月軸 + 加總 series（null 不計入）+ top-N 個別 series（缺月/null 補 null）。 */
export function buildTrend(rows: TrendRow[], topN: number = DEFAULT_TOP_N): TrendResult {
  // 1. union 月軸（含 searches=null 的月份；字典序＝時序）。
  const axisSet = new Set<string>();
  for (const row of rows) {
    for (const v of row.monthlyVolumes) {
      axisSet.add(monthKey(v));
    }
  }
  const axis = [...axisSet].sort();
  const axisIndex = new Map(axis.map((key, i) => [key, i]));

  // 2. 整體加總 series：缺月補 0、null 不計入。
  const total = axis.map(() => 0);
  for (const row of rows) {
    for (const v of row.monthlyVolumes) {
      if (v.searches !== null) {
        const i = axisIndex.get(monthKey(v));
        if (i !== undefined) {
          total[i] += v.searches;
        }
      }
    }
  }

  // 3. top-N 個別 series：對齊月軸，缺月或 null → null（0 保留為 0）。
  const series = rankTopN(rows, topN).map((row) => {
    const byMonth = new Map<string, number | null>();
    for (const v of row.monthlyVolumes) {
      byMonth.set(monthKey(v), v.searches);
    }
    const points = axis.map((key) => byMonth.get(key) ?? null);
    return { keyword: row.text, points };
  });

  return { axis, total, series };
}
