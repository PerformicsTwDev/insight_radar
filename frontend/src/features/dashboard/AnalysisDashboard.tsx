import { skipToken, useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { getKeywordAnalysisStatus } from '../../api/keywordAnalyses';
import { ErrorState, LoadingState } from '../../components/StateViews';
import { config } from '../../config/env';
import type { JobState, JobStatus } from '../../lib/jobState';
import { JobTrackingPanel } from '../job/JobTrackingPanel';
import { jobStateQueryKey } from '../job/useJobTracking';
import { analysisStatusQueryKey } from './analysisStatusQuery';
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
 * per-stream `['job', analysisId, 'stream']` cache. This container is a **passive
 * subscriber** to the MAIN analysis's entry only — it never opens a second,
 * un-deduped `GET :id` poller, and a sub-job (topics / journey / custom, which reuse
 * the machine on their own `streamPath`) can never leak its state into this readout.
 * Its own `GET :id` snapshot is fetched to learn readiness on first load (so a
 * **reopened** ready analysis, AC-1.1, shows content immediately without waiting for a
 * stream) and to pull the view's `features`; it does **not** poll continuously while
 * the run is live (the live transport owns progress), so a transient `unavailable`
 * blip while a job is tracked live can never blank a healthy view or tear it down.
 * Symmetrically, once the snapshot is a **viewable** terminal (a completed / partial
 * analysis being viewed), a transient blip on a later refetch (default
 * `refetchOnReconnect`) must not blank the healthy view either: the snapshot query
 * throw-retains its last-known-good value on a transient `unavailable`, so only a
 * definitive `not_found` (real 404) or a viewable→other genuine transition changes it
 * (§7, #645).
 */

const VIEWABLE_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>(['completed', 'partial']);

function isViewable(status: JobStatus): boolean {
  return VIEWABLE_STATUSES.has(status);
}

export function AnalysisDashboard({ analysisId }: { analysisId: string }): ReactElement {
  const view = useSearch({ strict: false, select: (s) => s.view });

  // Passive read of the SHARED live job-state (§7 subscriber dedup): the single
  // `useJobTracking` instance inside JobTrackingPanel mirrors normalised state here,
  // under the MAIN-analysis stream key (`jobStateQueryKey` defaults to `'stream'`) so a
  // sub-job on another `streamPath` never collides. `skipToken` → this observer only
  // reflects that cache; it never fetches, so no second transport is opened.
  const liveJob = useQuery<JobState>({
    queryKey: jobStateQueryKey(analysisId),
    queryFn: skipToken,
  }).data;
  const liveViewable = liveJob != null && isViewable(liveJob.status);

  // Authoritative snapshot for readiness + `features`. It is NOT a parallel poller
  // during the run (§7 — the live transport owns progress). It only re-polls in the
  // brief window where the shared live job-state reports a viewable terminal but this
  // snapshot has not caught up yet, to pull the fresh `features` the view gates on;
  // it stops the instant the snapshot catches up.
  const statusQuery = useQuery({
    queryKey: analysisStatusQueryKey(analysisId),
    // A transient `unavailable` (5xx / timeout / schema-invalid body) THROWS so TanStack
    // Query RETAINS the last-known-good snapshot instead of overwriting it (§7, #645).
    // Viewing a COMPLETED analysis, a refetch (default `refetchOnReconnect`) that briefly
    // 5xx's must never replace a healthy `ok` snapshot with a blip and blank the view.
    // A definitive `not_found` (real 404) is NOT transient → it RESOLVES (never retained
    // away), so a genuinely gone id still settles into AnalysisNotFound (FR-3). The throw
    // is local to this observer's retain-on-error contract; `getKeywordAnalysisStatus`
    // itself still never throws (mirrors the journey run-status retain, #654).
    queryFn: async () => {
      const res = await getKeywordAnalysisStatus(analysisId);
      if (res.kind === 'unavailable') {
        throw new Error('analysis status transiently unavailable');
      }
      return res;
    },
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

  // First-load transient failure — the snapshot never resolved (throw-retained to
  // `undefined`, so there is no last-known-good to show) AND no job is tracked yet → a
  // retry (nothing else to show). A retained *viewable* / *not_found* snapshot is handled
  // above; a retained non-viewable one (queued / running / failed / canceled) or a live
  // job falls through to the panel — so a mid-run or completed-view blip never surfaces
  // here (§7, #645).
  if (snapshot === undefined && liveJob == null) {
    return (
      <ErrorState
        message="無法載入分析狀態，請稍後再試。"
        onRetry={() => void statusQuery.refetch()}
      />
    );
  }

  // Otherwise the run is not yet viewable (a retained `ok` queued / running / failed /
  // canceled snapshot), OR a first blip is throw-retained while a job is tracked live.
  // Either way hand off to the live job-tracking panel — the ONE authoritative transport
  // (§7). A transient snapshot blip here is non-blanking + non-halting: the panel stays
  // mounted, its healthy SSE survives, and readiness self-heals from the shared
  // job-state (progress) / the snapshot catch-up (features) with no manual retry.
  return <JobTrackingPanel analysisId={analysisId} />;
}
