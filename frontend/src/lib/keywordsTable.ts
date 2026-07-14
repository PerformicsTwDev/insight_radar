// RED shell (T2.1, TC-15). Typed not-implemented placeholders so the tests are
// assertion-red, not compile-red (附錄 B). Green fills these in.

export const EM_DASH = '—';

export interface IntentDisplay {
  readonly zh: string;
  readonly color: string | null;
}

export function formatVolume(_value: number | null): string {
  return '';
}

export function formatCpc(_value: number | null): string {
  return '';
}

export function formatCpcRange(_low: number | null, _high: number | null): string {
  return '';
}

export function formatCompetition(_competition: string, _index: number | null): string {
  return '';
}

export function resolveIntent(_label: string): IntentDisplay {
  return { zh: '', color: null };
}

export function shouldVirtualize(_rowCount: number, _threshold: number): boolean {
  return false;
}
