import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { config } from '../../config/env';
import {
  cancelKeywordAnalysis,
  getKeywordAnalysisStatus,
  type KeywordAnalysisStatus,
  type StatusFetch,
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

/**
 * The default analysis-scoped stream sub-path — the MAIN analysis SSE (`:id/stream`).
 * Sub-jobs reuse this machine on their own sub-path (`topics/stream`, `journey/stream`,
 * a per-cid custom-assign path), so the main analysis is the `stream` default.
 */
export const DEFAULT_STREAM_PATH = 'stream';

/**
 * TanStack Query key the normalised job state is mirrored under so multiple
 * subscribers share one job (§7 subscriber dedup). **Scoped by `streamPath`** so the
 * main analysis and each sub-job (topics / journey / custom — same `analysisId`,
 * different `streamPath`) get their OWN entry and never collide: a sub-job settling
 * (e.g. `not_found` on a gone sub-resource) must not leak into the main analysis's
 * state that the dashboard reads. Same-`streamPath` subscribers still share one job.
 */
export function jobStateQueryKey(
  analysisId: string,
  streamPath: string = DEFAULT_STREAM_PATH,
): readonly [string, string, string] {
  return ['job', analysisId, streamPath];
}

/**
 * Pure SSE stream URL builder (`apiBaseUrl` empty → same-origin). `streamPath` is
 * the analysis-scoped sub-path and defaults to the main-analysis stream (`stream`);
 * the topics view reuses this machine by passing `topics/stream` (T3.3), so all
 * existing callers stay unchanged.
 */
export function buildStreamUrl(
  analysisId: string,
  apiBaseUrl: string,
  origin: string,
  streamPath = DEFAULT_STREAM_PATH,
): string {
  const base = apiBaseUrl || origin;
  return `${base}/api/v1/keyword-analyses/${encodeURIComponent(analysisId)}/${streamPath}`;
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
  options?: {
    eventSourceFactory?: EventSourceFactory;
    streamPath?: string;
    statusFetcher?: (id: string) => Promise<StatusFetch>;
  },
): JobTracking {
  const factory = options?.eventSourceFactory ?? defaultEventSourceFactory;
  // Which analysis-scoped SSE sub-path to open (`stream` main / `topics/stream` T3.3).
  const streamPath = options?.streamPath ?? DEFAULT_STREAM_PATH;
  // Authoritative DB-status source for C3-confirm + poll fallback. Defaults to the
  // MAIN analysis (`GET :id`); a sub-job (topics, T3.3) MUST pass its own scoped
  // fetcher, else confirm/poll would settle the sub-job from the wrong resource's
  // status (M3-R1 — the main analysis is already terminal once a topics run starts).
  const statusFetcher = options?.statusFetcher ?? getKeywordAnalysisStatus;
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
  // The key is scoped by `streamPath` (see {@link jobStateQueryKey}) so a sub-job never
  // overwrites the main analysis's state that other subscribers (the dashboard) read.
  useEffect(() => {
    if (analysisId) queryClient.setQueryData(jobStateQueryKey(analysisId, streamPath), state);
  }, [analysisId, streamPath, state, queryClient]);

  // Authoritative SSE transport: active ONLY while `transport === 'sse'` (§7).
  useEffect(() => {
    if (!analysisId) return;
    if (state.transport !== 'sse') return;

    const source = factory(
      buildStreamUrl(analysisId, config.apiBaseUrl, window.location.origin, streamPath),
    );
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
  }, [analysisId, state.transport, factory, streamPath]);

  // C3 confirmation: SSE `completed` → confirming → fetch DB truth → completed | partial.
  useEffect(() => {
    if (!analysisId) return;
    if (state.status !== 'confirming') return;
    let active = true;
    void statusFetcher(analysisId)
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
  }, [analysisId, state.status, statusFetcher]);

  // Poll fallback: enabled ONLY while `transport === 'poll'` (§7). TanStack Query
  // owns the polling lifecycle (interval + cancellation on disable/unmount).
  const pollQuery = useQuery({
    // `streamPath` scopes the cache entry per sub-job so the main-analysis and
    // topics instances (same analysisId) never share a poll result (M3-R1).
    queryKey: ['job-poll', streamPath, analysisId],
    // `enabled` guarantees a defined analysisId before this runs.
    queryFn: () => statusFetcher(analysisId!),
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
