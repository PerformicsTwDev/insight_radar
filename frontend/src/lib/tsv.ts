/**
 * TSV export (T2.7, FR-13; Design §6). **Pure** — the copy button is a thin shell
 * over this. Spreadsheet paste rules: a cell containing a tab / newline / carriage
 * return / double-quote is wrapped in double quotes with internal quotes doubled;
 * everything else is emitted verbatim. A `null` / `undefined` cell is an **empty
 * string**, never the text "null" (missing ≠ the literal word).
 */

export type TsvCell = string | number | null | undefined;

/** Characters that force a cell to be quoted (they are TSV field/record separators or the quote itself). */
const NEEDS_QUOTING = /[\t\n\r"]/;

/** Escape one cell per spreadsheet TSV rules; null/undefined → empty string. */
export function escapeTsvCell(value: TsvCell): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value);
  return NEEDS_QUOTING.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Build a TSV string: the header row followed by data rows, cells tab-separated
 * and rows newline-separated, every cell escaped via {@link escapeTsvCell}. The
 * result pastes back into a spreadsheet as the original column/row grid.
 */
export function toTsv(headers: readonly string[], rows: readonly (readonly TsvCell[])[]): string {
  return [headers, ...rows].map((row) => row.map(escapeTsvCell).join('\t')).join('\n');
}
