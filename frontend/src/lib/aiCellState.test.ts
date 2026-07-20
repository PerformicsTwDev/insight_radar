import { describe, expect, it } from 'vitest';
import {
  aiCellReducer,
  canGenerate,
  initialAiCellState,
  type AiCellState,
  type AiCellStatus,
} from './aiCellState';

/**
 * TC-28 (unit) — the pure ✦ on-demand cell state machine (T4.1, FR-18). Drives the
 * idle → loading → done | error lifecycle a single AI-intent cell walks through,
 * with guards so late/duplicate results never revive a settled cell and a
 * double-click never double-fires. The effectful hook (`useAiIntentCell`) only
 * feeds these events; all branching lives here (deterministically testable).
 */

const loading: AiCellState = { status: 'loading', summary: null, errorKind: null };
const done: AiCellState = { status: 'done', summary: '既有摘要', errorKind: null };
const errored: AiCellState = { status: 'error', summary: null, errorKind: 'unavailable' };

describe('TC-28 · initialAiCellState', () => {
  it('starts idle with no summary and no error (masked ✦)', () => {
    expect(initialAiCellState()).toEqual({ status: 'idle', summary: null, errorKind: null });
  });
});

describe('TC-28 · canGenerate', () => {
  it('allows starting from idle (first run) and error (retry) only', () => {
    expect(canGenerate('idle')).toBe(true);
    expect(canGenerate('error')).toBe(true);
  });

  it('forbids starting while loading (no double-fire) or done (no silent re-fetch)', () => {
    expect(canGenerate('loading')).toBe(false);
    expect(canGenerate('done')).toBe(false);
  });
});

describe('TC-28 · aiCellReducer transitions', () => {
  it('generate: idle → loading (clears any prior summary/error)', () => {
    expect(aiCellReducer(initialAiCellState(), { type: 'generate' })).toEqual(loading);
  });

  it('generate: error → loading (retry re-enters the in-flight state)', () => {
    expect(aiCellReducer(errored, { type: 'generate' })).toEqual(loading);
  });

  it('generate: ignored while loading (no double-fire) and while done (terminal)', () => {
    expect(aiCellReducer(loading, { type: 'generate' })).toBe(loading);
    expect(aiCellReducer(done, { type: 'generate' })).toBe(done);
  });

  it('resolved: loading → done with the summary', () => {
    expect(aiCellReducer(loading, { type: 'resolved', summary: '導購型意圖' })).toEqual({
      status: 'done',
      summary: '導購型意圖',
      errorKind: null,
    });
  });

  it('rejected: loading → error carrying the failure kind (invalid = 400 缺 normalizedText)', () => {
    expect(aiCellReducer(loading, { type: 'rejected', kind: 'invalid' })).toEqual({
      status: 'error',
      summary: null,
      errorKind: 'invalid',
    });
    expect(aiCellReducer(loading, { type: 'rejected', kind: 'unavailable' })).toEqual({
      status: 'error',
      summary: null,
      errorKind: 'unavailable',
    });
  });

  it('resolved/rejected: absorbed when not loading (late result never revives a settled cell)', () => {
    // A stray resolve after the cell already errored/settled must not overwrite it.
    expect(aiCellReducer(done, { type: 'resolved', summary: 'x' })).toBe(done);
    expect(aiCellReducer(errored, { type: 'resolved', summary: 'x' })).toBe(errored);
    expect(aiCellReducer(done, { type: 'rejected', kind: 'unavailable' })).toBe(done);
    expect(aiCellReducer(initialAiCellState(), { type: 'rejected', kind: 'invalid' })).toEqual(
      initialAiCellState(),
    );
  });

  it('drives a full idle → loading → done round-trip', () => {
    let state = initialAiCellState();
    state = aiCellReducer(state, { type: 'generate' });
    expect(state.status).toBe('loading');
    state = aiCellReducer(state, { type: 'resolved', summary: '資訊型意圖摘要' });
    expect(state).toEqual({ status: 'done', summary: '資訊型意圖摘要', errorKind: null });
  });

  it('drives a full idle → loading → error → (retry) loading round-trip', () => {
    let state = initialAiCellState();
    state = aiCellReducer(state, { type: 'generate' });
    state = aiCellReducer(state, { type: 'rejected', kind: 'unavailable' });
    expect(state.status).toBe('error');
    const retry = aiCellReducer(state, { type: 'generate' });
    expect(retry.status satisfies AiCellStatus).toBe('loading');
  });
});
