/** 逐月搜量點（映射後：`month` 已為 1–12 名稱映射，`searches` 缺值為 null，不補 0）。 */
export interface MonthlyVolumePoint {
  year: number;
  month: number;
  searches: number | null;
}

/**
 * 搜量觀測（store-on-change dedup 的比對單位，AC-29.4 / 正確性單點 S3）。
 * **全欄**＝`avgMonthlySearches / monthlyVolumes / competition / cpc micros`（與 Design §17.3 拍板一致）。
 * 註：`competitionIndex` 依 SSOT **不列入**相等比對（僅落列保存），故不在此結構內。
 */
export interface VolumeObservation {
  avgMonthlySearches: number | null;
  competition: string | null;
  cpcLowMicros: string | null;
  cpcHighMicros: string | null;
  monthlyVolumes: MonthlyVolumePoint[];
}

/**
 * store-on-change 全欄相等判定（AC-29.4 / S3）：本次觀測與成員最新快照**逐欄**相同 → true（略過寫入）。
 * `null` 與 `0` 視為不同（鐵律：null 不補 0）；`monthlyVolumes` 逐點保序比對（year/month/searches）。
 */
export function sameObservation(a: VolumeObservation, b: VolumeObservation): boolean {
  return (
    a.avgMonthlySearches === b.avgMonthlySearches &&
    a.competition === b.competition &&
    a.cpcLowMicros === b.cpcLowMicros &&
    a.cpcHighMicros === b.cpcHighMicros &&
    sameMonthlyVolumes(a.monthlyVolumes, b.monthlyVolumes)
  );
}

/** 逐月序列保序相等（長度 + 每點 year/month/searches；`null` searches 與 `0` 不等）。 */
function sameMonthlyVolumes(a: MonthlyVolumePoint[], b: MonthlyVolumePoint[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].year !== b[i].year || a[i].month !== b[i].month || a[i].searches !== b[i].searches) {
      return false;
    }
  }
  return true;
}

/**
 * 回填月數裁切（AC-29.1）：先依 (year, month) 升冪排序，再取**最近 `months` 個月**（時序保序）。
 * 預設 12＝Ads 原生窗（多半為 no-op）；缺月 `searches=null` 原樣保留（不補 0）。
 */
export function limitToRecentMonths(
  volumes: MonthlyVolumePoint[],
  months: number,
): MonthlyVolumePoint[] {
  const sorted = [...volumes].sort((x, y) => x.year - y.year || x.month - y.month);
  return months >= sorted.length ? sorted : sorted.slice(sorted.length - months);
}
