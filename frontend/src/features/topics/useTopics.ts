import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchTopics, startTopics, type TopicsResponse } from '../../api/topics';
import { useJobTracking, type EventSourceFactory } from '../job/useJobTracking';
import type { FeatureStatus } from '../../lib/featureGate';
import type { JobState, JobStatus } from '../../lib/jobState';

/**
 * Intent-topics gate flow (T3.3, FR-8) — composes the reusable pieces the M3
 * gate needs into one hook: the gate **phase** (from `GET :id` features, with a
 * local override once the user acts), the topics **job** (SSE via the refactored
 * {@link useJobTracking} on the `topics/stream` sub-path, poll/confirm inherited),
 * and the topics **result** (TanStack Query over `GET :id/topics`, fetched only
 * once ready). The same shape (start → job → content) is reused by T4.4 journey /
 * T5.2 custom. `eventSourceFactory` is injected in tests to drive the SSE
 * deterministically; prod uses the default.
 *
 * The gate phase starts from the server-reported `featureStatus` and follows it
 * until the user acts (start / retry) or the tracked job settles — at which point a
 * local override wins (a completed job unlocks the table without a `GET :id`
 * refetch). Once ready the job transport is torn down and the authoritative
 * `TopicsResponse` (its own `status`) drives the view.
 */

const TOPICS_STREAM_PATH = 'topics/stream';

/** Job terminal statuses that unlock the ready view (the run produced content). */
const READY_JOB_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>(['completed', 'partial']);
/** Job terminal statuses that surface the retry state (the run could not produce content). */
const FAILED_JOB_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>(['failed', 'not_found']);

/** Map a tracked-job status onto the gate phase it should drive (or null → no change yet). */
function jobPhase(status: JobStatus): FeatureStatus | null {
  if (READY_JOB_STATUSES.has(status)) return 'ready';
  if (FAILED_JOB_STATUSES.has(status)) return 'failed';
  return null;
}

export interface UseTopics {
  /** Effective gate phase driving the FeatureGate (server status, overridden by local actions). */
  readonly status: FeatureStatus;
  /** Live job state for the `running` progress view. */
  readonly jobState: JobState;
  /** Parsed topics result once ready (undefined while gated / on a fetch failure). */
  readonly topics: TopicsResponse | undefined;
  /** Start (or retry) the topics run — POST :id/topics, then track the job. */
  readonly start: () => Promise<void>;
}

export function useTopics(
  analysisId: string,
  featureStatus: FeatureStatus,
  options?: { eventSourceFactory?: EventSourceFactory },
): UseTopics {
  // Local phase override; null → follow the server-reported featureStatus.
  const [override, setOverride] = useState<FeatureStatus | null>(null);
  const status = override ?? featureStatus;

  // Track the topics SSE only while running (analysisId undefined → the hook idles).
  const trackingActive = status === 'running';
  const job = useJobTracking(trackingActive ? analysisId : undefined, {
    streamPath: TOPICS_STREAM_PATH,
    eventSourceFactory: options?.eventSourceFactory,
  });

  const jobStatus = job.state.status;
  useEffect(() => {
    if (status !== 'running') return;
    const next = jobPhase(jobStatus);
    if (next) setOverride(next);
  }, [status, jobStatus]);

  // Load the authoritative result only once ready (server state → Query cache).
  const query = useQuery({
    queryKey: ['topics', analysisId],
    queryFn: () => fetchTopics(analysisId),
    enabled: status === 'ready',
  });
  const fetched = query.data;
  const topics = fetched && fetched.ok ? fetched.topics : undefined;

  const start = useCallback(async () => {
    const res = await startTopics(analysisId);
    setOverride(res.ok ? 'running' : 'failed');
  }, [analysisId]);

  return { status, jobState: job.state, topics, start };
}
