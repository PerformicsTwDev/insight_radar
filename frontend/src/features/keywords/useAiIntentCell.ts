import { initialAiCellState, type AiCellState } from '../../lib/aiCellState';

/**
 * Effectful shell for one ✦ on-demand AI-intent cell (T4.1, FR-18; TC-28). Owns a
 * single {@link AiCellState} via the pure `aiCellReducer` and turns a click into the
 * `POST :id/ai-intent-summary` egress, feeding its result back as reducer events.
 * Each cell mounts its own instance → per-cell isolation (one cell's failure never
 * touches another, AC-18.1), and there is **no** view-gate coupling here (C13): the
 * hook only reads/writes its own cell state.
 */
export interface UseAiIntentCell {
  /** The cell's current state (masked / loading / summary / error). */
  readonly state: AiCellState;
  /** Generate (or retry) this cell's summary — a no-op unless idle/error. */
  readonly generate: () => Promise<void>;
}

export function useAiIntentCell(
  _analysisId: string,
  _normalizedText: string | undefined,
): UseAiIntentCell {
  // RED stub — not implemented (never leaves idle).
  return { state: initialAiCellState(), generate: () => Promise.resolve() };
}
