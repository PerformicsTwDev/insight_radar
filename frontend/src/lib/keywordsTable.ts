import { intentMap, type IntentMeta } from './intentMap';

/**
 * Pure cell-formatting for the keywords table (T2.1, FR-4). All branching lives
 * here so it is exhaustively unit-tested (core ≥90) and the component stays thin.
 * Governing rule C12: a missing value renders `—`, **never** 0.
 */

/** Missing-value marker (C12). */
export const EM_DASH = '—';
/** Range separator (en dash), distinct from the missing marker (em dash). */
const EN_DASH = '–';

/**
 * Competition enum → zh label (Google Ads: LOW / MEDIUM / HIGH). Single source for
 * the 高/中/低 mapping — reused by the table cell (below) and the filter options
 * (`features/keywords/filters`) so the label can never drift between the two.
 */
export const COMPETITION_ZH: Readonly<Record<string, string>> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
};

export interface IntentDisplay {
  readonly zh: string;
  readonly color: string | null;
}

/** Search volume → grouped number; null → — (missing ≠ 0, C12). */
export function formatVolume(value: number | null): string {
  return value === null ? EM_DASH : value.toLocaleString('en-US');
}

/** A single CPC bound → NT$ with two decimals; null → — (never 0, C12). */
export function formatCpc(value: number | null): string {
  return value === null ? EM_DASH : `NT$${value.toFixed(2)}`;
}

/**
 * CPC range → `low–high`. Both bounds null → a single — (AC-4.1). A single null
 * bound renders — within the range — never fabricated as 0 (mirrors the backend
 * rule: any micros null → cpc null).
 */
export function formatCpcRange(low: number | null, high: number | null): string {
  if (low === null && high === null) {
    return EM_DASH;
  }
  return `${formatCpc(low)}${EN_DASH}${formatCpc(high)}`;
}

/** Competition label (zh for LOW/MEDIUM/HIGH, raw otherwise) · index when present. */
export function formatCompetition(competition: string, index: number | null): string {
  const label = COMPETITION_ZH[competition] ?? competition;
  if (label === '') {
    return EM_DASH;
  }
  return index === null ? label : `${label} · ${index}`;
}

/** Intent label → zh + token color (C2 SSOT); unknown → raw label, no color. */
export function resolveIntent(label: string): IntentDisplay {
  // `Object.hasOwn` guards the plain-object lookup: a reserved-name label
  // (constructor / toString / hasOwnProperty …) would otherwise resolve to an
  // inherited Object.prototype member (truthy) and render {zh:undefined} as the
  // literal 'undefined' instead of falling back to the raw label (defensive).
  const meta: IntentMeta | undefined = Object.hasOwn(intentMap, label)
    ? (intentMap as Record<string, IntentMeta>)[label]
    : undefined;
  return meta ? { zh: meta.zh, color: meta.color } : { zh: label, color: null };
}

/** Virtualize only when the current page's row count exceeds the threshold (Design §14). */
export function shouldVirtualize(rowCount: number, threshold: number): boolean {
  return rowCount > threshold;
}
