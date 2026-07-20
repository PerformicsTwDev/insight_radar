import { createContext, useContext } from 'react';
import type { AiCellState } from '../../lib/aiCellState';
import type { AiBatchJobStatus } from '../../lib/aiIntentBatch';

/**
 * Context bridging the table-level ✦ batch coordinator ({@link useAiIntentBatch}) to
 * the ✦ column header + cells (T4.2, FR-18). Mounted only when the table has an
 * `analysisId`; `null` outside a provider so a standalone {@link AiIntentCell} falls
 * back to its own single-cell hook (T4.1 behaviour preserved).
 */
export interface AiIntentBatchApi {
  /** The batch job's lifecycle status, driving the column-header trigger. */
  readonly job: AiBatchJobStatus;
  /** The (masked/loading/done/error) state for one cell keyed by its normalizedText. */
  readonly cellStateFor: (key: string) => AiCellState;
  /** Generate (or retry) a single cell synchronously — shares the batch cell map. */
  readonly generateOne: (key: string) => Promise<void>;
  /** Trigger the whole-column `scope:'snapshot'` async job (progressive SSE fill). */
  readonly startBatch: () => Promise<void>;
}

export const AiIntentBatchContext = createContext<AiIntentBatchApi | null>(null);

export function useAiIntentBatchContext(): AiIntentBatchApi | null {
  return useContext(AiIntentBatchContext);
}
