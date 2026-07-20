import { useCallback, useReducer } from 'react';
import { summarizeKeywordIntent } from '../../api/aiIntentSummary';
import { aiCellReducer, initialAiCellState, type AiCellState } from '../../lib/aiCellState';

/**
 * Effectful shell for one ✦ on-demand AI-intent cell (T4.1, FR-18; TC-28). Owns a
 * single {@link AiCellState} via the pure `aiCellReducer` and turns a click into the
 * synchronous `POST :id/ai-intent-summary` egress, feeding its result back as
 * reducer events. Each cell mounts its own instance → per-cell isolation (one
 * cell's failure never touches another, AC-18.1), and there is **no** view-gate
 * coupling here (C13): the hook only reads/writes its own cell state — it never
 * touches the left-side dimension gate.
 */
export interface UseAiIntentCell {
  /** The cell's current state (masked / loading / summary / error). */
  readonly state: AiCellState;
  /** Generate (or retry) this cell's summary — a no-op unless idle/error. */
  readonly generate: () => Promise<void>;
}

export function useAiIntentCell(
  analysisId: string,
  normalizedText: string | undefined,
): UseAiIntentCell {
  const [state, dispatch] = useReducer(aiCellReducer, undefined, initialAiCellState);

  const generate = useCallback(async () => {
    // Only ever invoked from the idle/error button (loading/done render no button), so
    // re-entry can't occur; the pure reducer remains the single guard for the state
    // machine (a `generate` while loading/done is a no-op there anyway).
    dispatch({ type: 'generate' });
    const res = await summarizeKeywordIntent(analysisId, normalizedText);
    if (res.ok) {
      dispatch({ type: 'resolved', summary: res.summary });
    } else {
      dispatch({ type: 'rejected', kind: res.kind });
    }
  }, [analysisId, normalizedText]);

  return { state, generate };
}
