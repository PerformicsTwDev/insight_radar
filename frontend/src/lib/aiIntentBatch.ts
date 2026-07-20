import {
  aiCellReducer,
  initialAiCellState,
  type AiCellErrorKind,
  type AiCellEvent,
  type AiCellState,
} from './aiCellState';

/**
 * Pure ✦ column-header batch state machine (T4.2, FR-18; TC-28 / AC-18.1). **No
 * React / no IO** → core `src/lib/**` (≥90% coverage gate). The effectful shell
 * (`features/keywords/useAiIntentBatch`) turns the `scope:'snapshot'` job's POST +
 * SSE progress frames into {@link AiBatchEvent}s and feeds them here.
 *
 * This machine is a **thin fan-out** over the T4.1 per-cell `aiCellReducer`: it
 * holds one {@link AiCellState} per keyword (keyed by `normalizedText`) plus the
 * overall job status, and every per-cell transition delegates to `aiCellReducer`
 * while rewriting **only the one keyed entry** in an immutable Map copy. That is
 * what makes the AC-18.1 partial guarantee *structural* — a `cell_rejected` for one
 * key can never mutate a sibling's state object, so one cell's failure never
 * touches another. The batch reuses the exact same idle→loading→done|error
 * lifecycle (and its late/duplicate-result guards) that a single cell walks.
 *
 * Decoupling single-point (C13): like the per-cell machine, this models ONLY the
 * ✦ column's generation lifecycle — it has no knowledge of the left-side dimension
 * view-gate, so a batch run cannot implicitly unlock a dimension view.
 */

/** The batch job's lifecycle: masked → in-flight → finished | whole-job error. */
export type AiBatchJobStatus = 'idle' | 'running' | 'done' | 'error';

/** Per-keyword cell states + the overall job status. */
export interface AiBatchState {
  readonly job: AiBatchJobStatus;
  readonly cells: ReadonlyMap<string, AiCellState>;
}

/**
 * Events the reducer understands. `start` fans the header trigger out to every
 * target key; `cell_*` map one SSE progress frame (or a single-cell click) onto one
 * key; `job_*` settle the overall job.
 */
export type AiBatchEvent =
  | { readonly type: 'start'; readonly keys: readonly string[] }
  | { readonly type: 'cell_generate'; readonly key: string }
  | { readonly type: 'cell_resolved'; readonly key: string; readonly summary: string }
  | { readonly type: 'cell_rejected'; readonly key: string; readonly kind: AiCellErrorKind }
  | { readonly type: 'job_completed' }
  | { readonly type: 'job_failed' };

/** Fresh state: idle job, no cells touched (whole column masked). */
export function initialAiBatchState(): AiBatchState {
  return { job: 'idle', cells: new Map() };
}

/** The state for one cell — a fresh idle state for any key the batch has not touched. */
export function cellStateOf(state: AiBatchState, key: string): AiCellState {
  return state.cells.get(key) ?? initialAiCellState();
}

/**
 * Apply a per-cell {@link AiCellEvent} to a single key via the reused
 * `aiCellReducer`, returning a **new Map with only that key rewritten** (or the
 * same Map reference when the guarded transition is a no-op). Sibling entries keep
 * their exact object references → per-cell isolation is structural (AC-18.1).
 */
function applyCell(
  cells: ReadonlyMap<string, AiCellState>,
  key: string,
  event: AiCellEvent,
): ReadonlyMap<string, AiCellState> {
  const current = cells.get(key) ?? initialAiCellState();
  const next = aiCellReducer(current, event);
  if (next === current) return cells; // guarded no-op (e.g. late resolve) → no new Map
  const copy = new Map(cells);
  copy.set(key, next);
  return copy;
}

/**
 * The batch reducer. Pure; every per-cell transition delegates to `aiCellReducer`
 * (so its guards — no double-fire, no reviving a settled cell — hold per key). Job
 * terminals only apply while running.
 */
export function aiBatchReducer(state: AiBatchState, event: AiBatchEvent): AiBatchState {
  switch (event.type) {
    case 'start': {
      // Mask every target cell loading in one Map copy (a cell already done from an
      // earlier single click stays done — aiCellReducer's `generate` guard).
      const copy = new Map(state.cells);
      for (const key of event.keys) {
        const current = copy.get(key) ?? initialAiCellState();
        copy.set(key, aiCellReducer(current, { type: 'generate' }));
      }
      return { job: 'running', cells: copy };
    }
    case 'cell_generate':
      return { ...state, cells: applyCell(state.cells, event.key, { type: 'generate' }) };
    case 'cell_resolved':
      return {
        ...state,
        cells: applyCell(state.cells, event.key, { type: 'resolved', summary: event.summary }),
      };
    case 'cell_rejected':
      return {
        ...state,
        cells: applyCell(state.cells, event.key, { type: 'rejected', kind: event.kind }),
      };
    case 'job_completed':
      // A `completed` frame only arrives over the (running-only) stream.
      return state.job === 'running' ? { ...state, job: 'done' } : state;
    case 'job_failed':
      // Fails from `idle` too — a start whose POST rejected never reaches `running`,
      // yet the header must show the whole-job error. A settled `done` never regresses.
      return state.job === 'done' ? state : { ...state, job: 'error' };
  }
}

/**
 * Pure per-cell SSE `progress` frame → {@link AiBatchEvent} decoder. A frame must
 * carry a `normalizedText` (the cell key); `summary` → `cell_resolved`, `error` →
 * `cell_rejected` (an `invalid` code is the non-retryable missing-key case, anything
 * else is retryable `unavailable`). A malformed frame, a missing key, or a frame
 * with neither field returns `null` and is ignored (never crashes the stream).
 */
export function toAiBatchCellEvent(rawData: string): AiBatchEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const frame = parsed as { normalizedText?: unknown; summary?: unknown; error?: unknown };
  if (typeof frame.normalizedText !== 'string') return null;
  if (typeof frame.summary === 'string') {
    return { type: 'cell_resolved', key: frame.normalizedText, summary: frame.summary };
  }
  if (typeof frame.error === 'string') {
    const kind: AiCellErrorKind = frame.error === 'invalid' ? 'invalid' : 'unavailable';
    return { type: 'cell_rejected', key: frame.normalizedText, kind };
  }
  return null;
}
