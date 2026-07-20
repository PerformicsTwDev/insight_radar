import { describe, expect, it } from 'vitest';
import { initialAiCellState, type AiCellState } from './aiCellState';
import {
  aiBatchReducer,
  cellStateOf,
  initialAiBatchState,
  toAiBatchCellEvent,
  type AiBatchState,
} from './aiIntentBatch';

/**
 * TC-28 (unit, batch) — the pure ✦ column-header batch state machine (T4.2,
 * FR-18 / AC-18.1). A `scope:'snapshot'` job fans one column-header trigger out to
 * every target cell: `start` masks the whole column loading, then each SSE
 * `progress` frame resolves/rejects exactly one cell. **Per-cell isolation is
 * structural** — every transition delegates to the reused T4.1 `aiCellReducer` and
 * only ever rewrites the one keyed entry, so one cell's failure can never touch
 * another (the AC-18.1 partial guarantee). No React / no IO → core `src/lib/**`.
 */

const A = 'running shoes';
const B = 'cheap running shoes';
const C = 'best trail shoes';

const loading: AiCellState = { status: 'loading', summary: null, errorKind: null };

describe('TC-28 · initialAiBatchState', () => {
  it('starts idle with an empty cell map (whole column masked)', () => {
    const s = initialAiBatchState();
    expect(s.job).toBe('idle');
    expect(s.cells.size).toBe(0);
  });
});

describe('TC-28 · cellStateOf', () => {
  it('returns a fresh idle state for a key the batch has never touched', () => {
    expect(cellStateOf(initialAiBatchState(), A)).toEqual(initialAiCellState());
  });
});

describe('TC-28 · aiBatchReducer — start fans out to every target cell', () => {
  it('start: job → running and every listed key → loading', () => {
    const s = aiBatchReducer(initialAiBatchState(), { type: 'start', keys: [A, B, C] });
    expect(s.job).toBe('running');
    expect(cellStateOf(s, A)).toEqual(loading);
    expect(cellStateOf(s, B)).toEqual(loading);
    expect(cellStateOf(s, C)).toEqual(loading);
  });

  it('start: a cell already done (single-click earlier) is not re-masked (aiCellReducer guard)', () => {
    let s: AiBatchState = aiBatchReducer(initialAiBatchState(), { type: 'cell_generate', key: A });
    s = aiBatchReducer(s, { type: 'cell_resolved', key: A, summary: '既有摘要' });
    s = aiBatchReducer(s, { type: 'start', keys: [A, B] });
    // A stays done (no silent re-fetch); B enters loading.
    expect(cellStateOf(s, A)).toEqual({ status: 'done', summary: '既有摘要', errorKind: null });
    expect(cellStateOf(s, B)).toEqual(loading);
  });
});

describe('TC-28 · aiBatchReducer — progress maps to exactly one cell (isolation)', () => {
  it('cell_resolved fills only its own key; sibling cells keep their loading refs', () => {
    const started = aiBatchReducer(initialAiBatchState(), { type: 'start', keys: [A, B, C] });
    const aBefore = cellStateOf(started, A);
    const cBefore = cellStateOf(started, C);

    const next = aiBatchReducer(started, { type: 'cell_resolved', key: B, summary: '導購型意圖' });

    expect(cellStateOf(next, B)).toEqual({ status: 'done', summary: '導購型意圖', errorKind: null });
    // A and C are untouched — same object references (structural per-cell isolation).
    expect(cellStateOf(next, A)).toBe(aBefore);
    expect(cellStateOf(next, C)).toBe(cBefore);
  });

  it('cell_rejected errors only the failing cell — the other cells are never polluted (AC-18.1 partial)', () => {
    let s = aiBatchReducer(initialAiBatchState(), { type: 'start', keys: [A, B, C] });
    s = aiBatchReducer(s, { type: 'cell_rejected', key: B, kind: 'unavailable' });

    expect(cellStateOf(s, B)).toEqual({ status: 'error', summary: null, errorKind: 'unavailable' });
    // The failure of B did not knock A or C out of their in-flight state.
    expect(cellStateOf(s, A)).toEqual(loading);
    expect(cellStateOf(s, C)).toEqual(loading);

    // The rest of the column can still settle to done independently.
    s = aiBatchReducer(s, { type: 'cell_resolved', key: A, summary: 'A 摘要' });
    s = aiBatchReducer(s, { type: 'cell_resolved', key: C, summary: 'C 摘要' });
    expect(cellStateOf(s, A).status).toBe('done');
    expect(cellStateOf(s, C).status).toBe('done');
    // B is still the only error.
    expect(cellStateOf(s, B).status).toBe('error');
  });

  it('a late/duplicate resolve never revives a settled cell (delegates to aiCellReducer guard)', () => {
    let s = aiBatchReducer(initialAiBatchState(), { type: 'start', keys: [A] });
    s = aiBatchReducer(s, { type: 'cell_rejected', key: A, kind: 'unavailable' });
    const errored = s;
    // A stray resolve after A already errored must be absorbed (same state ref).
    s = aiBatchReducer(s, { type: 'cell_resolved', key: A, summary: 'stray' });
    expect(s.cells).toBe(errored.cells);
    expect(cellStateOf(s, A).status).toBe('error');
  });
});

describe('TC-28 · aiBatchReducer — job lifecycle', () => {
  it('cell_generate masks a single cell loading without starting the whole job', () => {
    const s = aiBatchReducer(initialAiBatchState(), { type: 'cell_generate', key: A });
    expect(s.job).toBe('idle'); // single-cell path leaves the batch job idle
    expect(cellStateOf(s, A)).toEqual(loading);
  });

  it('job_completed: running → done (batch finished)', () => {
    const running = aiBatchReducer(initialAiBatchState(), { type: 'start', keys: [A] });
    expect(aiBatchReducer(running, { type: 'job_completed' }).job).toBe('done');
  });

  it('job_failed: running → error (whole job failed)', () => {
    const running = aiBatchReducer(initialAiBatchState(), { type: 'start', keys: [A] });
    expect(aiBatchReducer(running, { type: 'job_failed' }).job).toBe('error');
  });

  it('job_completed is ignored from idle (a completed frame only arrives over the running stream)', () => {
    const idle = initialAiBatchState();
    expect(aiBatchReducer(idle, { type: 'job_completed' })).toBe(idle);
  });

  it('job_failed from idle → error (a start whose POST rejected never reaches running)', () => {
    // The header must surface a whole-job error even when the run never opened a stream.
    expect(aiBatchReducer(initialAiBatchState(), { type: 'job_failed' }).job).toBe('error');
  });

  it('a settled done job absorbs a late job_failed (never regresses done → error)', () => {
    const running = aiBatchReducer(initialAiBatchState(), { type: 'start', keys: [A] });
    const done = aiBatchReducer(running, { type: 'job_completed' });
    expect(aiBatchReducer(done, { type: 'job_failed' })).toBe(done);
  });
});

describe('TC-28 · toAiBatchCellEvent (pure per-cell SSE frame decoder)', () => {
  it('decodes a resolved frame → cell_resolved keyed on normalizedText', () => {
    expect(toAiBatchCellEvent(JSON.stringify({ normalizedText: A, summary: '導購型意圖' }))).toEqual({
      type: 'cell_resolved',
      key: A,
      summary: '導購型意圖',
    });
  });

  it('decodes a rejected frame → cell_rejected (default unavailable = retryable)', () => {
    expect(toAiBatchCellEvent(JSON.stringify({ normalizedText: B, error: 'llm_timeout' }))).toEqual({
      type: 'cell_rejected',
      key: B,
      kind: 'unavailable',
    });
  });

  it('maps an explicit invalid error code to the non-retryable invalid kind', () => {
    expect(toAiBatchCellEvent(JSON.stringify({ normalizedText: B, error: 'invalid' }))).toEqual({
      type: 'cell_rejected',
      key: B,
      kind: 'invalid',
    });
  });

  it('returns null for a frame with no normalizedText, malformed JSON, or neither summary nor error', () => {
    expect(toAiBatchCellEvent(JSON.stringify({ summary: 'x' }))).toBeNull();
    expect(toAiBatchCellEvent('not-json')).toBeNull();
    expect(toAiBatchCellEvent(JSON.stringify({ normalizedText: A }))).toBeNull();
  });

  it('returns null for a non-object JSON payload (null / primitive)', () => {
    expect(toAiBatchCellEvent('null')).toBeNull();
    expect(toAiBatchCellEvent('42')).toBeNull();
  });
});
