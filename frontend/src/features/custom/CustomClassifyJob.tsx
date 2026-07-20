import { useCallback, useEffect, type ReactElement } from 'react';
import { fetchCustomClassifyAssignStatus } from '../../api/customClassifyAssign';
import { customAssignStreamPath } from '../../lib/customView';
import { JobProgress } from '../job/JobProgress';
import { useJobTracking, type EventSourceFactory } from '../job/useJobTracking';
import type { JobStatus } from '../../lib/jobState';

/**
 * 自訂分類歸類 job tracker (T5.2, FR-16) — a thin adapter over the reusable
 * {@link useJobTracking} machine, scoped to one (analysisId, cid) assignment run. It
 * opens the assignments SSE sub-path, and its C3-confirm + poll fallback settle off the
 * run's **own** status (`GET .../assignments`), never the terminal main analysis (M3-R1).
 * On a terminal status it reports up: completed/partial → {@link onDone} (the dynamic
 * `custom:{cid}` tab is registered), failed/not-found → {@link onFailed}. Mounted with a
 * `key={cid}` by the container so each classification run gets a fresh machine (the SSE
 * re-subscribes) rather than inheriting a prior job's terminal state.
 */

/** Job terminal statuses that produced content (custom has no `partial`, but treat it as ready). */
const READY_JOB_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>(['completed', 'partial']);
/** Job terminal statuses that could not produce content. */
const FAILED_JOB_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>(['failed', 'not_found']);

export interface CustomClassifyJobProps {
  readonly analysisId: string;
  readonly cid: string;
  readonly onDone: (cid: string) => void;
  readonly onFailed: (cid: string) => void;
  readonly eventSourceFactory?: EventSourceFactory;
}

export function CustomClassifyJob({
  analysisId,
  cid,
  onDone,
  onFailed,
  eventSourceFactory,
}: CustomClassifyJobProps): ReactElement {
  // Confirm/poll the classify run's OWN status — not the main analysis (mirrors M3-R1).
  const statusFetcher = useCallback(
    (id: string) => fetchCustomClassifyAssignStatus(id, cid),
    [cid],
  );
  const job = useJobTracking(analysisId, {
    streamPath: customAssignStreamPath(cid),
    statusFetcher,
    eventSourceFactory,
  });

  const status = job.state.status;
  useEffect(() => {
    if (READY_JOB_STATUSES.has(status)) onDone(cid);
    else if (FAILED_JOB_STATUSES.has(status)) onFailed(cid);
  }, [status, cid, onDone, onFailed]);

  return <JobProgress state={job.state} />;
}
