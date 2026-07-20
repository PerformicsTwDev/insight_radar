import { initialAiCellState, type AiCellState } from '../../lib/aiCellState';
import type { AiBatchJobStatus } from '../../lib/aiIntentBatch';
import type { EventSourceFactory } from '../job/useJobTracking';

/**
 * Effectful shell for the ✦ column-header batch coordinator (T4.2, FR-18). STUB —
 * typed shell for the red step; real POST + SSE fan-out land in green.
 */
export interface UseAiIntentBatch {
  readonly job: AiBatchJobStatus;
  readonly cellStateFor: (key: string) => AiCellState;
  readonly generateOne: (key: string) => Promise<void>;
  readonly startBatch: () => Promise<void>;
}

export function useAiIntentBatch(
  _analysisId: string,
  _keys: readonly string[],
  _options?: { eventSourceFactory?: EventSourceFactory },
): UseAiIntentBatch {
  return {
    job: 'idle',
    cellStateFor: () => initialAiCellState(),
    generateOne: async () => {}, // STUB
    startBatch: async () => {}, // STUB
  };
}
