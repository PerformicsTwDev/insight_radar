import { useCallback, useEffect, useReducer, useRef } from 'react';
import { config } from '../../config/env';
import { startBatchIntentSummary, summarizeKeywordIntent } from '../../api/aiIntentSummary';
import {
  aiBatchReducer,
  cellStateOf,
  initialAiBatchState,
  toAiBatchCellEvent,
  type AiBatchJobStatus,
} from '../../lib/aiIntentBatch';
import type { AiCellState } from '../../lib/aiCellState';
import {
  buildStreamUrl,
  defaultEventSourceFactory,
  type EventSourceFactory,
} from '../job/useJobTracking';

/**
 * Effectful shell for the ✦ column-header batch coordinator (T4.2, FR-18; TC-28 /
 * AC-18.1) — a thin adapter over the pure `lib/aiIntentBatch` machine. It owns the
 * per-cell {@link AiCellState} map (reusing T4.1's `aiCellReducer` per key) and
 * drives two paths onto the **same** map: a single-cell click (`generateOne` → the
 * synchronous `scope:'keyword'` egress) and the whole-column batch (`startBatch` →
 * the `scope:'snapshot'` 202 job, then progressive per-cell fill over SSE).
 *
 * SSE convention reuse (M0–M3): the batch stream is opened with the same
 * `EventSourceFactory` seam + `buildStreamUrl` (analysis-scoped sub-path) as
 * {@link useJobTracking}, and torn down on settle/unmount. The generic job machine
 * (`lib/jobState`) is deliberately **not** reused wholesale here: its `progress`
 * decoder normalises frames into an aggregate `JobProgress` (phase/percent), which
 * would erase the per-cell `{ normalizedText, summary }` payload this batch must
 * route to individual cells. So the per-cell fan-out has its own decoder while the
 * transport plumbing is shared.
 *
 * Decoupling single-point (C13): this hook only reads/writes its own ✦ cell map —
 * it never touches the left-side dimension view-gate, so a batch run cannot unlock
 * a dimension view.
 */

/** Analysis-scoped SSE sub-path for the batch job (mirrors the `topics/stream` reuse, T3.3). */
const BATCH_STREAM_PATH = 'ai-intent-summary/stream';

export interface UseAiIntentBatch {
  /** The batch job status (drives the column-header trigger: idle → running → done|error). */
  readonly job: AiBatchJobStatus;
  /** The (masked/loading/done/error) state for one cell keyed by its normalizedText. */
  readonly cellStateFor: (key: string) => AiCellState;
  /** Generate (or retry) a single cell synchronously (`scope:'keyword'`) — same cell map. */
  readonly generateOne: (key: string) => Promise<void>;
  /** Trigger the whole-column `scope:'snapshot'` async job (progressive SSE fill). */
  readonly startBatch: () => Promise<void>;
}

export function useAiIntentBatch(
  analysisId: string,
  keys: readonly string[],
  options?: { eventSourceFactory?: EventSourceFactory },
): UseAiIntentBatch {
  const factory = options?.eventSourceFactory ?? defaultEventSourceFactory;
  const [state, dispatch] = useReducer(aiBatchReducer, undefined, initialAiBatchState);

  // Latest target keys, read at `startBatch` time (so the callback needn't re-create
  // as the row set changes — the batch masks whatever is currently on screen).
  const keysRef = useRef(keys);
  keysRef.current = keys;

  const generateOne = useCallback(
    async (key: string) => {
      dispatch({ type: 'cell_generate', key });
      const res = await summarizeKeywordIntent(analysisId, key);
      if (res.ok) dispatch({ type: 'cell_resolved', key, summary: res.summary });
      else dispatch({ type: 'cell_rejected', key, kind: res.kind });
    },
    [analysisId],
  );

  const startBatch = useCallback(async () => {
    const res = await startBatchIntentSummary(analysisId);
    if (!res.ok) {
      dispatch({ type: 'job_failed' });
      return;
    }
    // Mask the whole column loading; the SSE effect (below) opens once `job` is running.
    dispatch({ type: 'start', keys: keysRef.current });
  }, [analysisId]);

  // Batch SSE: active ONLY while the job is running (opened after the 202, torn down
  // on completed/failed/unmount). Per-cell `progress` frames fan out to the map; the
  // job-level `completed`/`failed` events settle the header. A transport error is a
  // whole-job failure (there is no per-cell poll to reconstruct from).
  useEffect(() => {
    if (state.job !== 'running') return;

    const source = factory(
      buildStreamUrl(analysisId, config.apiBaseUrl, window.location.origin, BATCH_STREAM_PATH),
    );
    if (!source) {
      dispatch({ type: 'job_failed' }); // no EventSource on this platform
      return;
    }

    source.onerror = () => {
      dispatch({ type: 'job_failed' });
    };
    source.addEventListener('progress', (event: MessageEvent) => {
      const cellEvent = toAiBatchCellEvent(String(event.data));
      if (cellEvent) dispatch(cellEvent);
    });
    source.addEventListener('completed', () => {
      dispatch({ type: 'job_completed' });
    });
    source.addEventListener('failed', () => {
      dispatch({ type: 'job_failed' });
    });

    return () => {
      source.close();
    };
  }, [state.job, analysisId, factory]);

  const cellStateFor = useCallback((key: string) => cellStateOf(state, key), [state]);

  return { job: state.job, cellStateFor, generateOne, startBatch };
}
