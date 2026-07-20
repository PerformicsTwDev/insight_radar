import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJourneyRun, fetchJourneyStatus, startJourney } from '../../api/journey';
import { postQuery } from '../../api/query';
import { useJobTracking, type EventSourceFactory } from '../job/useJobTracking';
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
   */
  readonly partial: boolean;
  /** Start (or retry) the journey run — POST :id/journey, then track the job. */
  readonly start: () => Promise<void>;
}

export function useJourney(
  analysisId: string,
  featureStatus: FeatureStatus,
  options?: { eventSourceFactory?: EventSourceFactory },
): UseJourney {
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
    enabled: status === 'ready',
  });
  const table =
    tableQuery.data?.ok && tableQuery.data.view.kind === 'table' ? tableQuery.data.view : undefined;

  // Partial is read from the authoritative journey run status (`GET :id/journey`)
  // once ready — the stage 表 has no status field, so unlike topics we cannot read it
  // off the content response. A fetch failure defaults partial=false (shown complete).
  const runQuery = useQuery({
    queryKey: ['journey-run', analysisId],
    queryFn: () => fetchJourneyRun(analysisId),
    enabled: status === 'ready',
  });
  const partial = runQuery.data?.ok ? runQuery.data.run.status === 'partial' : false;

  const start = useCallback(async () => {
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
  }, [analysisId]);

  return { status, jobState: job.state, rows: table?.rows, blocked, partial, start };
}
