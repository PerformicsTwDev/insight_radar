import {
  initialAiCellState,
  type AiCellErrorKind,
  type AiCellState,
} from './aiCellState';

/**
 * Pure ✦ column-header batch state machine (T4.2, FR-18; TC-28 / AC-18.1). STUB —
 * typed shell for the red step; the real reducer/decoder land in green.
 */

export type AiBatchJobStatus = 'idle' | 'running' | 'done' | 'error';

export interface AiBatchState {
  readonly job: AiBatchJobStatus;
  readonly cells: ReadonlyMap<string, AiCellState>;
}

export type AiBatchEvent =
  | { readonly type: 'start'; readonly keys: readonly string[] }
  | { readonly type: 'cell_generate'; readonly key: string }
  | { readonly type: 'cell_resolved'; readonly key: string; readonly summary: string }
  | { readonly type: 'cell_rejected'; readonly key: string; readonly kind: AiCellErrorKind }
  | { readonly type: 'job_completed' }
  | { readonly type: 'job_failed' };

export function initialAiBatchState(): AiBatchState {
  return { job: 'idle', cells: new Map() };
}

export function cellStateOf(state: AiBatchState, key: string): AiCellState {
  return state.cells.get(key) ?? initialAiCellState();
}

export function aiBatchReducer(state: AiBatchState, _event: AiBatchEvent): AiBatchState {
  return state; // STUB
}

export function toAiBatchCellEvent(_rawData: string): AiBatchEvent | null {
  return null; // STUB
}
