import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJourneyRun, fetchJourneyStatus, startJourney } from '../../api/journey';
import { postQuery } from '../../api/query';
import { useJobTracking, type EventSourceFactory } from '../job/useJobTracking';
import { useInFlightGuard } from '../../hooks/useInFlightGuard';
import type { FeatureStatus } from '../../lib/featureGate';
import type { JobState, JobStatus } from '../../lib/jobState';

/**
 * 購買歷程 gate flow (T4.4, FR-15) — **reuses the T3.3 topics shape** (see
 * {@link useTopics}) so the M4 journey gate is the same start → job → content
 * machine: the gate **phase** (from `GET :id` features, with a local override once
 * the user acts), the journey **job** (SSE via {@link useJobTracking} on the
 * `journey/stream` sub-path, poll/confirm inherited), and the journey **content**
 * (the stage 表 via the view-router `POST /query {view:'journey'}`, fetched only
 * once ready — journey has no dedicated content endpoint, unlike topics).
 * `eventSourceFactory` is injected in tests to drive the SSE deterministically.
 *
 * The gate phase starts from the server-reported `featureStatus` and follows it
 * until the user acts (start / retry) or the tracked job settles — at which point a
 * local override wins (a completed job unlocks the table without a `GET :id`
 * refetch). The job's C3-confirm + poll are journey-scoped (statusFetcher →
 * `GET :id/journey`), so they never settle off the (already-terminal) main analysis.
 */

const JOURNEY_STREAM_PATH = 'journey/stream';

/** Job terminal statuses that unlock the ready view (the run produced content). */
const READY_JOB_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>(['completed', 'partial']);
/** Job terminal statuses that surface the retry state (the run could not produce content). */
const FAILED_JOB_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>(['failed', 'not_found']);
/** POST-journey statuses meaning the base analysis snapshot isn't ready yet (FR-8/FR-9 boundary). */
const SNAPSHOT_NOT_READY_STATUSES: ReadonlySet<number> = new Set<number>([409, 425]);

/** Map a tracked-job status onto the gate phase it should drive (or null → no change yet). */
function jobPhase(status: JobStatus): FeatureStatus | null {
  if (READY_JOB_STATUSES.has(status)) return 'ready';
  if (FAILED_JOB_STATUSES.has(status)) return 'failed';
  return null;
}

export interface UseJourney {
  /** Effective gate phase driving the FeatureGate (server status, overridden by local actions). */
  readonly status: FeatureStatus;
  /** Live job state for the `running` progress view. */
  readonly jobState: JobState;
  /** Journey stage-table rows once ready (undefined while gated / on a fetch failure). */
  readonly rows: readonly Record<string, unknown>[] | undefined;
  /**
   * The base analysis snapshot isn't ready (last start returned 409/425) — surface
   * a "finish the analysis first" hint instead of a failed/retry state (FR-8/FR-9).
   */
  readonly blocked: boolean;
  /**
   * The journey run completed only partially — read from the **authoritative** run
   * status (`GET :id/journey`), not the stage 表 (which carries no status). Drives
   * the FeatureGate partial notice so a partial run is never shown as complete (C3).
   * `false` **only** when the status is a definitively non-partial run; while the
   * status is unknown (loading / a transient fetch blip) it stays `true` — the
   * conservative side of C3 (never claim complete without an authoritative status, #644).
   */
  readonly partial: boolean;
  /** Start (or retry) the journey run — POST :id/journey, then track the job. */
  readonly start: () => Promise<void>;
}

export function useJourney(
  analysisId: string,
  featureStatus: FeatureStatus,
  options?: { eventSourceFactory?: EventSourceFactory; gateOnly?: boolean },
): UseJourney {
  // Gate-only (M7-R24 [c1]): a caller that needs ONLY the gate phase + start (the 搜尋詞總表 uses
  // its own all-stages column join, not `rows`/`partial`) skips the stage-表 + run-status content
  // fetches entirely — otherwise a ready journey fires a first-50 page + run-status query that are
  // discarded on every render of the grand table.
  const gateOnly = options?.gateOnly ?? false;
  // Local phase override; null → follow the server-reported featureStatus.
  const [override, setOverride] = useState<FeatureStatus | null>(null);
  // Set when the last start hit a not-ready snapshot (409/425) — a prerequisite hint,
  // not a failed run; the gate stays at not_generated with a distinct notice.
  const [blocked, setBlocked] = useState(false);
  const status = override ?? featureStatus;

  // Track the journey SSE only while running (analysisId undefined → the hook idles).
  const trackingActive = status === 'running';
  const job = useJobTracking(trackingActive ? analysisId : undefined, {
    streamPath: JOURNEY_STREAM_PATH,
    // Confirm/poll the JOURNEY run's own status — not the main analysis (mirrors M3-R1).
    statusFetcher: fetchJourneyStatus,
    eventSourceFactory: options?.eventSourceFactory,
  });

  const jobStatus = job.state.status;
  useEffect(() => {
    if (status !== 'running') return;
    const next = jobPhase(jobStatus);
    if (next) setOverride(next);
  }, [status, jobStatus]);

  // Load the stage 表 (view-router) only once ready (server state → Query cache).
  const tableQuery = useQuery({
    queryKey: ['journey-view', analysisId],
    queryFn: () => postQuery(analysisId, { view: 'journey' }),
    enabled: !gateOnly && status === 'ready',
  });
  const table =
    tableQuery.data?.ok && tableQuery.data.view.kind === 'table' ? tableQuery.data.view : undefined;

  // Partial is read from the authoritative journey run status (`GET :id/journey`)
  // once ready — the stage 表 has no status field, so unlike topics we cannot read it
  // off the content response. The queryFn THROWS on a non-ok fetch so TanStack Query
  // retains the last-known-good `data` instead of overwriting a known 'partial' with a
  // blip: a transient run-status failure must never downgrade partial→complete (C3, #644).
  const runQuery = useQuery({
    queryKey: ['journey-run', analysisId],
    queryFn: async () => {
      const res = await fetchJourneyRun(analysisId);
      if (!res.ok) throw new Error(`journey run status unavailable (${res.status})`);
      return res.run;
    },
    enabled: !gateOnly && status === 'ready',
  });
  // C3 (#644): `data` is the last-known-good run status — TanStack retains it across a
  // blip (the throwing queryFn errors without clearing it), so `data` present covers both
  // a definitive status AND a blip-after-success. It is `undefined` only while the status
  // is still unknown (never resolved yet). Only a DEFINITIVE non-partial status downgrades
  // to complete (partial=false); an unknown status stays conservative (`true`), since a
  // possibly-partial run shown without the notice would be shown as complete, violating C3.
  const partial = runQuery.data ? runQuery.data.status === 'partial' : true;

  // The start CTA stays clickable until the 202 lands (`override` flips to running only
  // after the POST resolves), so a fast double-click would enqueue a duplicate journey
  // run — guard re-entry while the enqueue POST is outstanding (M4-R1, #603).
  const guardStart = useInFlightGuard();
  const start = useCallback(
    () =>
      guardStart(async () => {
        setBlocked(false);
        const res = await startJourney(analysisId);
        if (res.ok) {
          setOverride('running');
        } else if (SNAPSHOT_NOT_READY_STATUSES.has(res.status)) {
          // Base analysis snapshot isn't ready — not a failed run. Stay gated (CTA remains)
          // and let the view show a "finish the analysis first" hint.
          setOverride(null);
          setBlocked(true);
        } else {
          setOverride('failed');
        }
      }),
    [analysisId, guardStart],
  );

  return { status, jobState: job.state, rows: table?.rows, blocked, partial, start };
}
