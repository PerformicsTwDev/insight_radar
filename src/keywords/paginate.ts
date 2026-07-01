/**
 * 排序 + keyset/cursor 分頁（T5.2，FR-6）。對**不可變** `ResultSnapshot.rows`（已 `applyFilter`）操作。
 *
 * - 預設 `avgMonthlySearches desc`；`sortBy`/`sortDir` 生效（Design §9.1:825）。
 * - **確定性全序**：以 `normalizedText asc` tie-break（每列 nt 唯一）——重複查／翻頁**不漂移**（§9.1:826）；
 *   `null` 排序值一律置尾（不假造為可比較數值，缺值≠0）。
 * - keyset/cursor 優於 offset（對固化 snapshot 穩定）；亦提供 `page/pageSize` offset 相容。
 *   cursor 編碼「上一頁最後一列的 normalizedText」，下一頁自其後續接。
 */

/** 可排序列（snapshot row 子集；`SnapshotRowData` 結構上滿足）。 */
export interface SortableRow {
  normalizedText: string;
  text: string;
  avgMonthlySearches: number | null;
  competitionIndex: number | null;
  cpcLow: number | null;
  cpcHigh: number | null;
}

export type SortField = 'avgMonthlySearches' | 'competitionIndex' | 'cpcLow' | 'cpcHigh' | 'text';
export type SortDir = 'asc' | 'desc';

export interface SortSpec {
  sortBy?: SortField;
  sortDir?: SortDir;
}

export interface PageSpec {
  page?: number;
  pageSize?: number;
  cursor?: string;
}

export interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
  /** 取下一頁用的 cursor；已是最後一頁 → `null`。 */
  cursor: string | null;
}

export interface PageResult<T> {
  rows: T[];
  meta: PageMeta;
}

const DEFAULT_SORT_BY: SortField = 'avgMonthlySearches';
const DEFAULT_SORT_DIR: SortDir = 'desc';
const DEFAULT_PAGE_SIZE = 50;

/** 比較兩列某欄；`null` 一律置尾（不受方向影響）；非 null 值套用方向 `dir`（asc=+1 / desc=-1）。 */
function compareField(a: SortableRow, b: SortableRow, field: SortField, dir: number): number {
  if (field === 'text') {
    return a.text < b.text ? -dir : a.text > b.text ? dir : 0;
  }
  const av = a[field];
  const bv = b[field];
  if (av === null && bv === null) {
    return 0;
  }
  if (av === null) {
    return 1; // a 置尾
  }
  if (bv === null) {
    return -1; // b 置尾
  }
  return (av - bv) * dir;
}

/** 依 `sortBy`/`sortDir` 排序（不改動輸入）；tie-break `normalizedText asc` 保確定性全序。 */
export function sortRows<T extends SortableRow>(
  rows: T[],
  sortBy: SortField = DEFAULT_SORT_BY,
  sortDir: SortDir = DEFAULT_SORT_DIR,
): T[] {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = compareField(a, b, sortBy, dir);
    if (primary !== 0) {
      return primary;
    }
    // tie-break：normalizedText asc（每列 nt 唯一 → 全序確定、翻頁不漂移；相等不可能發生）。
    return a.normalizedText < b.normalizedText ? -1 : 1;
  });
}

/** cursor = base64url(JSON({ nt }))；集中編碼，避免各處自組。 */
function encodeCursor(normalizedText: string): string {
  return Buffer.from(JSON.stringify({ nt: normalizedText }), 'utf8').toString('base64url');
}

/**
 * 解 cursor 的 `nt`。**不可解析**（非 base64url / 非合法 JSON / 無 `nt`）→ 回 `null`，由 caller 視為
 * 「未知位置」（空尾頁）——cursor 為 opaque，畸形值不得讓讀取 hot path 拋 500。嚴格 400 驗證屬 T5.4。
 */
function decodeCursor(cursor: string): string | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      nt?: unknown;
    };
    return typeof parsed.nt === 'string' ? parsed.nt : null;
  } catch {
    return null;
  }
}

/**
 * 排序 + 分頁固化 snapshot 列，回 `{ rows, meta }`。cursor 存在時走 keyset（自 cursor 列之後接續）；
 * 否則走 offset（`page`/`pageSize`）。未知 / 不可解析 cursor → 視為已到資料尾（空頁）。
 * ⚠ cursor 僅在**與產生它時相同的 `sortBy`/`sortDir`** 下有效（不同排序會在新序中誤接續）。
 * 防禦：`pageSize`/`page` < 1 一律夾為合法值（不產生 NaN/負 slice 垃圾）；嚴格上限/400 驗證屬 T5.4。
 */
export function selectPage<T extends SortableRow>(
  rows: T[],
  sort: SortSpec = {},
  page: PageSpec = {},
): PageResult<T> {
  const sorted = sortRows(rows, sort.sortBy, sort.sortDir);
  const total = sorted.length;
  const pageSize = Math.max(1, page.pageSize ?? DEFAULT_PAGE_SIZE);

  let startIndex: number;
  let pageNum: number;
  if (page.cursor !== undefined) {
    const nt = decodeCursor(page.cursor);
    const idx = nt === null ? -1 : sorted.findIndex((row) => row.normalizedText === nt);
    startIndex = idx >= 0 ? idx + 1 : total; // 未知/不可解析 cursor → 空尾頁
    pageNum = Math.floor(startIndex / pageSize) + 1;
  } else {
    pageNum = Math.max(1, page.page ?? 1); // page < 1 夾為第 1 頁
    startIndex = (pageNum - 1) * pageSize;
  }

  const pageRows = sorted.slice(startIndex, startIndex + pageSize);
  const endIndex = startIndex + pageRows.length;
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    last !== undefined && endIndex < total ? encodeCursor(last.normalizedText) : null;

  return { rows: pageRows, meta: { total, page: pageNum, pageSize, cursor: nextCursor } };
}
