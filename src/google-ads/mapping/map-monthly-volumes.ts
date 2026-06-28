import { enums } from 'google-ads-api';

/** Google Ads `MonthlySearchVolume` 原始形狀（Opteo camelCase；month 可能為 proto 整數或名稱）。 */
export interface RawMonthlySearchVolume {
  year: number | string;
  month: string | number;
  monthlySearches?: number | string | null;
}

/** 映射後的逐月搜量：`month` 已映射 1–12（名稱映射），`searches` 缺值為 null（不補 0）。 */
export interface MonthlySearchVolume {
  year: number;
  month: number;
  searches: number | null;
}

// 套件 enum 雙向表（整數 ↔ 名稱）；用於把 proto 整數先反查回名稱。
const MONTH_BY_VALUE = enums.MonthOfYear as unknown as Record<number, string>;

/**
 * `MonthOfYear` 名稱 → 月份 1–12。**以名稱映射，不可用 proto 整數值**：
 * proto 中 `JANUARY=2`（`UNSPECIFIED=0, UNKNOWN=1, JANUARY=2 …`），用整數會整體 off-by-one。
 */
const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  JANUARY: 1,
  FEBRUARY: 2,
  MARCH: 3,
  APRIL: 4,
  MAY: 5,
  JUNE: 6,
  JULY: 7,
  AUGUST: 8,
  SEPTEMBER: 9,
  OCTOBER: 10,
  NOVEMBER: 11,
  DECEMBER: 12,
};

/** 把原始 month（名稱或 proto 整數）解析為 1–12；無法辨識（含 UNSPECIFIED/UNKNOWN）→ null。 */
function resolveMonth(month: string | number): number | null {
  const name = typeof month === 'number' ? MONTH_BY_VALUE[month] : month;
  return name ? (MONTH_NAME_TO_NUMBER[name] ?? null) : null;
}

/** 把原始搜量解析為 number；缺值 → null（不補 0）。 */
function resolveSearches(searches: number | string | null | undefined): number | null {
  return searches === null || searches === undefined ? null : Number(searches);
}

/**
 * 映射逐月搜量為趨勢資料（FR-5、TC-5）。
 *
 * - `month` **以名稱**映射 1–12（JANUARY→1…DECEMBER→12，避開 proto off-by-one）。
 * - `monthlySearches` 缺值保留 null（該月斷點，不補 0）。
 * - 無法辨識月份（UNSPECIFIED/UNKNOWN/未知）的條目略過。
 */
export function mapMonthlyVolumes(
  raw: RawMonthlySearchVolume[] | undefined,
): MonthlySearchVolume[] {
  if (!raw) {
    return [];
  }
  const out: MonthlySearchVolume[] = [];
  for (const entry of raw) {
    const month = resolveMonth(entry.month);
    if (month === null) {
      continue;
    }
    out.push({ year: Number(entry.year), month, searches: resolveSearches(entry.monthlySearches) });
  }
  return out;
}
