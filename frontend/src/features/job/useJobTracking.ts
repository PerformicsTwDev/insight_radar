import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { config } from '../../config/env';
import {
  cancelKeywordAnalysis,
  getKeywordAnalysisStatus,
  type KeywordAnalysisStatus,
} from '../../api/keywordAnalyses';
import {
  initialJobState,
  isConnectionStale,
  jobReducer,
  toJobEvent,
  type JobEvent,
  type JobState,
} from '../../lib/jobState';

/**
 * Unified job-tracking hook (T1.3, FR-3; Design §5/§6/§7) — a thin **effectful
 * shell** over the pure `lib/jobState` machine. It opens an SSE `EventSource`,
 * turns named events into {@link JobEvent}s, and dispatches them into the
 * reducer; on the SSE `completed` event it fetches `GET :id` to let the DB truth
 * decide `completed` vs `partial` (C3); on SSE error / heartbeat silence it
 * closes the stream and falls back to polling `GET :id` (C6). Exactly one
 * authoritative transport drives the state at a time — SSE **XOR** poll (§7):
 * the SSE effect runs only while `transport === 'sse'`, and the poll query is
 * `enabled` only while `transport === 'poll'`. The normalised state is mirrored
 * into the TanStack Query cache so multiple subscribers share one job (§7).
 */

/** Minimal structural view of the browser `EventSource` the hook depends on (DI seam for tests). */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
  onopen: ((ev: Event) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
}

/** Opens an SSE connection for `url`, or `null` when `EventSource` is unavailable (→ poll). */
export type EventSourceFactory = (url: string) => EventSourceLike | null;

/** What `useJobTracking` exposes to the presentational layer. */
export interface JobTracking {
  readonly state: JobState;
  readonly cancel: () => Promise<void>;
}

/** Pure SSE stream URL builder (`apiBaseUrl` empty → same-origin). */
export function buildStreamUrl(analysisId: string, apiBaseUrl: string, origin: string): string {
  const base = apiBaseUrl || origin;
  return `${base}/api/v1/keyword-analyses/${encodeURIComponent(analysisId)}/stream`;
}

/** Default factory: real `EventSource` (with credentials) when the platform has one, else `null`. */
export const defaultEventSourceFactory: EventSourceFactory = (url) => {
  if (typeof EventSource === 'undefined') return null;
  return new EventSource(url, { withCredentials: true });
};

/** DB status snapshot → the reducer's authoritative `db_status` event (null-safe fields). */
function toDbStatusEvent(status: KeywordAnalysisStatus): JobEvent {
  return {
    type: 'db_status',
    status: status.status,
    progress: status.progress ?? null,
    result: status.result ?? null,
    error: status.error ?? null,
  };
}

export function useJobTracking(
  analysisId: string | undefined,
  options?: { eventSourceFactory?: EventSourceFactory },
): JobTracking {
  const factory = options?.eventSourceFactory ?? defaultEventSourceFactory;
  const [state, dispatch] = useReducer(jobReducer, undefined, initialJobState);
  const queryClient = useQueryClient();

  // Liveness clock: last time SSE showed activity (open / named event). The
  // heartbeat interval compares this to `now` via the pure staleness predicate.
  const lastEventAtRef = useRef<number>(Date.now());

  // Reset when the tracked job changes. TanStack Router does NOT remount the route
  // on search-only navigation, so `?analysisId=A` → `?analysisId=B` re-renders this
  // SAME hook with a new id while `state` still holds job A's (possibly terminal)
  // state — which would show job A's status for job B and never subscribe to B.
  // Dispatch a `reset` on id-change so B starts fresh (SSE re-subscribes). Ref-guarded
  // so the initial mount (already fresh) doesn't redundantly reset.
  const trackedIdRef = useRef(analysisId);
  useEffect(() => {
    if (trackedIdRef.current !== analysisId) {
      trackedIdRef.current = analysisId;
      dispatch({ type: 'reset' });
    }
  }, [analysisId]);

  // Mirror the normalised job state into the Query cache (shared across subscribers, §7).
  useEffect(() => {
    if (analysisId) queryClient.setQueryData(['job', analysisId], state);
  }, [analysisId, state, queryClient]);

  // Authoritative SSE transport: active ONLY while `transport === 'sse'` (§7).
  useEffect(() => {
    if (!analysisId) return;
    if (state.transport !== 'sse') return;

    const source = factory(buildStreamUrl(analysisId, config.apiBaseUrl, window.location.origin));
    if (!source) {
      dispatch({ type: 'sse_error' }); // no EventSource on this platform → poll fallback
      return;
    }

    lastEventAtRef.current = Date.now();
    const touch = () => {
      lastEventAtRef.current = Date.now();
    };
    source.onopen = () => {
      touch();
      dispatch({ type: 'sse_open' });
    };
    source.onerror = () => {
      dispatch({ type: 'sse_error' });
    };
    const onNamed = (event: MessageEvent) => {
      touch();
      const jobEvent = toJobEvent(event.type, String(event.data));
      if (jobEvent) dispatch(jobEvent);
    };
    source.addEventListener('progress', onNamed);
    source.addEventListener('completed', onNamed);
    source.addEventListener('failed', onNamed);

    const heartbeat = setInterval(() => {
      if (isConnectionStale(lastEventAtRef.current, Date.now(), config.sseHeartbeatTimeoutMs)) {
        dispatch({ type: 'heartbeat_timeout' });
      }
    }, config.pollIntervalMs);

    return () => {
      source.close();
      clearInterval(heartbeat);
    };
  }, [analysisId, state.transport, factory]);

  // C3 confirmation: SSE `completed` → confirming → fetch DB truth → completed | partial.
  useEffect(() => {
    if (!analysisId) return;
    if (state.status !== 'confirming') return;
    let active = true;
    void getKeywordAnalysisStatus(analysisId)
      .then((res) => {
        if (!active) return;
        if (res.kind === 'ok') dispatch(toDbStatusEvent(res.status));
        // Confirm GET says the id is gone (404) → settle into the not-found
        // terminal (stops both transports) rather than parking in `confirming`.
        else if (res.kind === 'not_found') dispatch({ type: 'not_found' });
        // Transient failure (other non-2xx / schema-invalid body) → don't park in
        // `confirming`; fall back to poll (`sse_error` → transport='poll'), which
        // re-fetches `GET :id` on an interval until the DB truth resolves.
        else dispatch({ type: 'sse_error' });
      })
      .catch(() => {
        // Confirm GET rejected (network failure) → same poll fallback; also prevents
        // an unhandled promise rejection.
        if (active) dispatch({ type: 'sse_error' });
      });
    return () => {
      active = false;
    };
  }, [analysisId, state.status]);

  // Poll fallback: enabled ONLY while `transport === 'poll'` (§7). TanStack Query
  // owns the polling lifecycle (interval + cancellation on disable/unmount).
  const pollQuery = useQuery({
    queryKey: ['job-poll', analysisId],
    // `enabled` guarantees a defined analysisId before this runs.
    queryFn: () => getKeywordAnalysisStatus(analysisId!),
    enabled: Boolean(analysisId) && state.transport === 'poll',
    refetchInterval: config.pollIntervalMs,
  });

  useEffect(() => {
    const res = pollQuery.data;
    if (!res) return;
    if (res.kind === 'ok') dispatch(toDbStatusEvent(res.status));
    // A persistent 404 settles to not-found (terminal → transport 'none' disables
    // this query), so the poll can't spin forever on a gone id (FR-3 boundary).
    else if (res.kind === 'not_found') dispatch({ type: 'not_found' });
    // 'unavailable' → transient; keep polling toward recovery (no dispatch).
  }, [pollQuery.data]);

  const cancel = useCallback(async () => {
    if (!analysisId) return;
    await cancelKeywordAnalysis(analysisId);
    dispatch({ type: 'cancel' });
  }, [analysisId]);

  return { state, cancel };
}
