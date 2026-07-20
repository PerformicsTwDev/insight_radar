/**
 * Pure ✦ on-demand cell state machine (T4.1, FR-18; TC-28). **No React / no IO** →
 * core `src/lib/**` (≥90% coverage gate). The effectful shell
 * (`features/keywords/useAiIntentCell`) is a thin adapter that turns the
 * `POST :id/ai-intent-summary` egress result into {@link AiCellEvent}s and feeds
 * them here; **all branching lives in this reducer + the pure predicates** so
 * every transition is deterministically unit-testable, and the same machine is
 * reused per-cell by the T4.2 column-header batch (each grid cell an independent
 * instance — one cell's failure never touches another, AC-18.1).
 *
 * Decoupling single-point (C13): this machine models ONLY the cell's own
 * generation lifecycle. It has no knowledge of — and never signals — the
 * left-side dimension view-gate (`featureStatusOf` / topics·journey·custom). ✦
 * generation must not implicitly unlock a dimension view (that gate is driven
 * solely by its own analysis), so there is deliberately no transition here that
 * could reach into view-gate state.
 */

/** The four states a ✦ cell can be in: masked (idle) → in-flight (loading) → filled (done) | error. */
export const AI_CELL_STATUSES = ['idle', 'loading', 'done', 'error'] as const;
export type AiCellStatus = (typeof AI_CELL_STATUSES)[number];

/**
 * Why a generation failed. `invalid` = the request itself was rejected as
 * malformed (**400** — e.g. `scope:'keyword'` with no `normalizedText`, AC-31.2),
 * surfaced distinctly because a retry can't fix a structurally-missing key;
 * `unavailable` = any other non-2xx / network failure (retryable).
 *
 * NOTE (FR-31 deferred): the SERP-grounded ✦ column adds a `409 serp_not_captured`
 * gate ("需先擷取搜尋結果"). That backend endpoint (FR-31) lands after M14 and is
 * feature-flagged on separately; a distinct error kind for it is deliberately NOT
 * modelled here yet — T4.1 is the generic machine, tested against a mock endpoint.
 */
export type AiCellErrorKind = 'invalid' | 'unavailable';

/**
 * The normalised per-cell state the hook exposes to the cell component. Modelled
 * as a **discriminated union** so illegal states are unrepresentable: only `done`
 * carries a (non-null) `summary`, only `error` carries an `errorKind`. This lets
 * the cell read `state.summary` / `state.errorKind` after narrowing without a
 * null-coalescing fallback for a case that can't occur.
 */
export type AiCellState =
  | { readonly status: 'idle'; readonly summary: null; readonly errorKind: null }
  | { readonly status: 'loading'; readonly summary: null; readonly errorKind: null }
  | { readonly status: 'done'; readonly summary: string; readonly errorKind: null }
  | { readonly status: 'error'; readonly summary: null; readonly errorKind: AiCellErrorKind };

/** Events the reducer understands (produced by the effectful shell from the egress result / user click). */
export type AiCellEvent =
  | { readonly type: 'generate' }
  | { readonly type: 'resolved'; readonly summary: string }
  | { readonly type: 'rejected'; readonly kind: AiCellErrorKind };

/** Fresh state for an ungenerated cell: masked, no summary, no error. */
export function initialAiCellState(): AiCellState {
  return { status: 'idle', summary: null, errorKind: null };
}

/**
 * Whether a (re)generation may be started from this status — only from a settled
 * non-pending state: `idle` (first run) or `error` (retry). `loading` is in-flight
 * (no double-fire); `done` is terminal for a single cell (no silent re-fetch).
 */
export function canGenerate(status: AiCellStatus): boolean {
  return status === 'idle' || status === 'error';
}

/**
 * The ✦ cell reducer. Pure; every guard/transition is exercised by the unit test.
 * A `generate` is ignored unless {@link canGenerate}; `resolved`/`rejected` apply
 * only while `loading` (late/duplicate results are absorbed, so a settled cell
 * never regresses).
 */
export function aiCellReducer(state: AiCellState, event: AiCellEvent): AiCellState {
  switch (event.type) {
    case 'generate':
      // Only (re)start from a settled non-pending state; clear any prior summary/error.
      return canGenerate(state.status)
        ? { status: 'loading', summary: null, errorKind: null }
        : state;
    case 'resolved':
      // Apply only to the in-flight request — a late/duplicate result never revives a
      // settled cell (per-cell isolation, AC-18.1).
      return state.status === 'loading'
        ? { status: 'done', summary: event.summary, errorKind: null }
        : state;
    case 'rejected':
      return state.status === 'loading'
        ? { status: 'error', summary: null, errorKind: event.kind }
        : state;
  }
}
