/**
 * 統一 FilterSpec（T5.1，FR-7/FR-14）。`/keywords` 與所有 `/query` view 共用的**單一**篩選來源
 * （AC-14.1/AC-7.8）——篩選只實作一次，避免 view 間 drift（Design §9.1）。
 *
 * 記憶體快路徑：對「不可變 snapshot 列」跑 JS predicate（n 小、亞毫秒，FR-7/NFR-1）。DB 後備路徑
 * （pg_trgm contains、jsonb `?|`/`@>` any/all）為次要、語意對齊此單一來源（見 view-router / TC-36）。
 * 各子篩選 **server-side AND** 組合；未設的欄位不施加任何約束。
 */
export interface FilterSpec {
  volumeMin?: number;
  volumeMax?: number;
  /** 文字 contains（大小寫不敏感）。 */
  q?: string;
  /** 意圖類別多選；空陣列＝不限。 */
  intent?: string[];
  /** `any`＝命中任一選定類別（預設）；`all`＝須含全部選定類別。 */
  intentMode?: 'any' | 'all';
  /** 競爭度 enum 多選；空陣列＝不限。 */
  competition?: string[];
  competitionIndexMin?: number;
  competitionIndexMax?: number;
  cpcMin?: number;
  cpcMax?: number;
}

/** buildPredicate 作用的列形狀（snapshot row 子集；`SnapshotRowData` 結構上滿足此型）。 */
export interface FilterableKeyword {
  text: string;
  avgMonthlySearches: number | null;
  competition: string;
  competitionIndex: number | null;
  cpcLow: number | null;
  cpcHigh: number | null;
  intent: string[];
}

type Predicate = (row: FilterableKeyword) => boolean;

/**
 * 數值落在 [min, max]（含邊界）。**僅在至少一界已設時呼叫**；缺值（`null`）一律不滿足已設的界
 * （缺值≠0：不假造為可比較數值）。
 */
function inRange(value: number | null, min: number | undefined, max: number | undefined): boolean {
  if (value === null) {
    return false;
  }
  if (min !== undefined && value < min) {
    return false;
  }
  if (max !== undefined && value > max) {
    return false;
  }
  return true;
}

/**
 * 由 `FilterSpec` 組出單一 predicate（§9.1 五種語意）。各 active 子篩選收集為小函式、AND 組合
 * ——此為 `/keywords` 與所有 view 的**唯一**過濾來源（{@link applyFilter} 委派於此）。
 */
export function buildPredicate(filter: FilterSpec): Predicate {
  const checks: Predicate[] = [];

  // 搜量 range（含邊界；null 不滿足）
  if (filter.volumeMin !== undefined || filter.volumeMax !== undefined) {
    checks.push((r) => inRange(r.avgMonthlySearches, filter.volumeMin, filter.volumeMax));
  }

  // 文字 contains（大小寫不敏感）
  if (filter.q !== undefined) {
    const needle = filter.q.toLowerCase();
    checks.push((r) => r.text.toLowerCase().includes(needle));
  }

  // 意圖 multi-select（any＝some-in-set，預設；all＝every-in-labels）
  if (filter.intent && filter.intent.length > 0) {
    const selected = filter.intent;
    const matchAll = filter.intentMode === 'all';
    checks.push((r) =>
      matchAll
        ? selected.every((label) => r.intent.includes(label))
        : selected.some((label) => r.intent.includes(label)),
    );
  }

  // 競爭度 enum 多選
  if (filter.competition && filter.competition.length > 0) {
    const set = new Set(filter.competition);
    checks.push((r) => set.has(r.competition));
  }

  // 競爭度 index range（含邊界；null 不滿足）
  if (filter.competitionIndexMin !== undefined || filter.competitionIndexMax !== undefined) {
    checks.push((r) =>
      inRange(r.competitionIndex, filter.competitionIndexMin, filter.competitionIndexMax),
    );
  }

  // CPC 區間重疊：cpcHigh >= min AND cpcLow <= max（任一缺值即不滿足對應界）
  if (filter.cpcMin !== undefined) {
    const min = filter.cpcMin;
    checks.push((r) => r.cpcHigh !== null && r.cpcHigh >= min);
  }
  if (filter.cpcMax !== undefined) {
    const max = filter.cpcMax;
    checks.push((r) => r.cpcLow !== null && r.cpcLow <= max);
  }

  return (row) => checks.every((check) => check(row));
}

/**
 * 套用 `FilterSpec`：以**單一** {@link buildPredicate} 過濾、保留輸入順序。`/keywords` 與所有 view 的
 * 共用入口——確保跨 view 同一過濾語意、無 drift（TC-37）。
 */
export function applyFilter<T extends FilterableKeyword>(rows: T[], filter: FilterSpec): T[] {
  const predicate = buildPredicate(filter);
  return rows.filter(predicate);
}
