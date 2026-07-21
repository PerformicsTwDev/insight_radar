import { skipToken, useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { getKeywordAnalysisStatus } from '../../api/keywordAnalyses';
import { ErrorState, LoadingState } from '../../components/StateViews';
import { config } from '../../config/env';
import type { DbStatus, JobState } from '../../lib/jobState';
import { JobTrackingPanel } from '../job/JobTrackingPanel';
import { AnalysisNotFound } from './ViewStates';
import { ViewContent } from './ViewContent';

/**
 * Analysis dashboard container (T6.0, FR-1). Once the URL carries an `analysisId`,
 * this decides what the main pane shows:
 * - queued / running → the live job-tracking progress panel (existing T1.3);
 * - completed / partial → the active `view` routed to content ({@link ViewContent});
 * - 404 → an explicit not-found (FR-3 boundary, never a frozen "分析進行中");
 * - first-load transient failure → a retry.
 *
 * **Design §7 (single authoritative transport / subscriber dedup).** The one
 * {@link JobTrackingPanel}'s `useJobTracking` owns the live transport for this job
 * (SSE-first / poll-fallback) and mirrors its normalised state into the shared
 * `['job', analysisId]` cache. This container is a **passive subscriber** to that
 * shared state — it never opens a second, un-deduped `GET :id` poller. Its own
 * `GET :id` snapshot is fetched to learn readiness on first load (so a **reopened**
 * ready analysis, AC-1.1, shows content immediately without waiting for a stream)
 * and to pull the view's `features`; it does **not** poll continuously while the run
 * is live (the live transport owns progress), so a transient `unavailable` blip
 * while a job is tracked live can never blank a healthy view or tear the stream down.
 */

const VIEWABLE_DB_STATUSES: ReadonlySet<DbStatus> = new Set<DbStatus>(['completed', 'partial']);

function isViewable(status: DbStatus): boolean {
  return VIEWABLE_DB_STATUSES.has(status);
}

export function AnalysisDashboard({ analysisId }: { analysisId: string }): ReactElement {
  const view = useSearch({ strict: false, select: (s) => s.view });

  // Passive read of the SHARED live job-state (§7 subscriber dedup): the single
  // `useJobTracking` instance inside JobTrackingPanel mirrors normalised state here.
  // `skipToken` → this observer only reflects that cache; it never fetches, so no
  // second transport is opened. `undefined` until the panel mounts and publishes.
  const liveJob = useQuery<JobState>({
    queryKey: ['job', analysisId],
    queryFn: skipToken,
  }).data;
  const liveViewable = liveJob != null && isViewable(liveJob.status as DbStatus);

  // Authoritative snapshot for readiness + `features`. It is NOT a parallel poller
  // during the run (§7 — the live transport owns progress). It only re-polls in the
  // brief window where the shared live job-state reports a viewable terminal but this
  // snapshot has not caught up yet, to pull the fresh `features` the view gates on;
  // it stops the instant the snapshot catches up.
  const statusQuery = useQuery({
    queryKey: ['analysis-status', analysisId],
    queryFn: () => getKeywordAnalysisStatus(analysisId),
    refetchInterval: (query) => {
      const snap = query.state.data;
      const snapViewable = snap?.kind === 'ok' && isViewable(snap.status.status);
      return liveViewable && !snapViewable ? config.pollIntervalMs : false;
    },
  });

  const snapshot = statusQuery.data;
  if (statusQuery.isPending) {
    return <LoadingState label="載入分析中…" />;
  }

  // A genuine terminal not-found (404) from either authoritative source → explicit
  // not-found, never a frozen "分析進行中".
  if (snapshot?.kind === 'not_found' || liveJob?.status === 'not_found') {
    return <AnalysisNotFound />;
  }

  // Ready (viewable): route the active view to content, gated by the snapshot's features.
  if (snapshot?.kind === 'ok' && isViewable(snapshot.status.status)) {
    return <ViewContent analysisId={analysisId} view={view} features={snapshot.status.features} />;
  }

  // First-load transient failure with NO job being tracked yet → a retry (nothing
  // else to show). Once a job IS tracked live (below), a transient `unavailable` is
  // non-fatal and must not surface here.
  if (snapshot?.kind === 'unavailable' && liveJob == null) {
    return (
      <ErrorState
        message="無法載入分析狀態，請稍後再試。"
        onRetry={() => void statusQuery.refetch()}
      />
    );
  }

  // Otherwise the run is not yet viewable (queued / running / failed / canceled), OR
  // the snapshot is transiently unavailable while a job is tracked live. Either way
  // hand off to the live job-tracking panel — the ONE authoritative transport (§7).
  // A transient snapshot blip here is non-blanking + non-halting: the panel stays
  // mounted, its healthy SSE survives, and readiness self-heals from the shared
  // job-state (progress) / the snapshot catch-up (features) with no manual retry.
  return <JobTrackingPanel analysisId={analysisId} />;
}
