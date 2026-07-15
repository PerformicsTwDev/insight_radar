/** TSV export (T2.7, FR-13). — RED STUB — */

export type TsvCell = string | number | null | undefined;

export function escapeTsvCell(_value: TsvCell): string {
  throw new Error('not implemented');
}

export function toTsv(_headers: readonly string[], _rows: readonly (readonly TsvCell[])[]): string {
  throw new Error('not implemented');
}
