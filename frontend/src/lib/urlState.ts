// TDD red stub (T1.1 / TC-11) — typed not-implemented shell so the test file
// compiles (assertion-red, not compile-red; see .claude/rules/test-authoring.md #1).
// Real implementation lands in the green commit.

/**
 * Known dashboard views (T1.1 placeholder allowlist). The authoritative set is
 * ultimately backend view-metadata driven (T3.1, `GET /views`) and dynamic
 * `custom:{cid}` views arrive at M5; for the shell we validate against a static
 * allowlist so an unknown `view` in the URL normalises to a not-found state.
 */
export const KNOWN_VIEWS = ['keywords', 'trend', 'intent', 'journey', 'history'] as const;
export type KnownView = (typeof KNOWN_VIEWS)[number];

/**
 * Authoritative UI state carried in the URL search params (Design §5 — URL is
 * state). `filters` is an opaque passthrough string for T1.1; the full
 * FilterSpec chips↔spec codec is M2/T2.5 (Design §6 C4).
 */
export interface AppSearch {
  readonly analysisId?: string;
  readonly view?: KnownView;
  readonly page?: number;
  readonly pageSize?: number;
  readonly cursor?: string;
  readonly filters?: string;
}

export function serialize(_state: AppSearch): Record<string, string> {
  return { __stub: 'not-implemented' };
}

export function deserialize(_raw: Record<string, unknown>): AppSearch {
  return { analysisId: 'STUB', view: 'keywords', page: 999 };
}
