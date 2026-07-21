import type { KeywordRow } from '../api/keywords';
import { COMPETITION_ZH, resolveIntent } from './keywordsTable';
import { toTsv, type TsvCell } from './tsv';

/**
 * 搜尋詞總表 → TSV export (T2.7/T6.4, FR-13). **Pure** — the copy button ({@link
 * CopyTsvButton}) is a thin clipboard shell over this, so the grand table and the
 * AI-insight sidebar (T4.3) share the one `lib/tsv` export path (T2.7 ③).
 *
 * Cells carry **raw** values (not the table's display strings): a null metric maps
 * to an empty cell via `escapeTsvCell` (missing ≠ 0, and ≠ the display "—", C12), so
 * the pasted grid holds real numbers a spreadsheet can compute on. Intent labels use
 * the C2 zh SSOT (matching the table); competition uses the shared 高/中/低 map with a
 * raw fallback for UNSPECIFIED. Row order is the current (filtered/paged) view order.
 */

/** Column headers, aligned to the visible table (sparkline excluded — not tabular). */
export const KEYWORDS_TSV_HEADERS = [
  '搜尋詞',
  '意圖',
  '搜尋量',
  '競爭度',
  '競爭度指數',
  'CPC 最低',
  'CPC 最高',
] as const;

/** One keyword row → its raw TSV cells (nulls kept null → empty cell, never 0). */
function rowCells(row: KeywordRow): TsvCell[] {
  const intent = row.intentLabels.map((label) => resolveIntent(label).zh).join('、');
  return [
    row.text,
    intent,
    row.avgMonthlySearches,
    COMPETITION_ZH[row.competition] ?? row.competition,
    row.competitionIndex,
    row.cpcLow,
    row.cpcHigh,
  ];
}

/** Build the TSV grid (header + one row per keyword) for the current view's rows. */
export function keywordsToTsv(rows: readonly KeywordRow[]): string {
  return toTsv(KEYWORDS_TSV_HEADERS, rows.map(rowCells));
}
