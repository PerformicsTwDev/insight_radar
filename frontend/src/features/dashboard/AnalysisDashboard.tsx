import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { getKeywordAnalysisStatus } from '../../api/keywordAnalyses';
import { ErrorState, LoadingState } from '../../components/StateViews';
import { config } from '../../config/env';
import type { DbStatus } from '../../lib/jobState';
import { JobTrackingPanel } from '../job/JobTrackingPanel';
import { AnalysisNotFound } from './ViewStates';
import { ViewContent } from './ViewContent';

/**
 * Analysis dashboard container (T6.0, FR-1). Once the URL carries an `analysisId`,
 * this decides what the main pane shows from the **authoritative** `GET :id`
 * snapshot (status + features):
 * - queued / running → the live job-tracking progress panel (existing T1.3);
 * - completed / partial → the active `view` routed to content ({@link ViewContent});
 * - 404 → an explicit not-found (FR-3 boundary, never a frozen "分析進行中");
 * - transient failure → a retry.
 *
 * Readiness comes from the snapshot (not the SSE machine) so a **reopened** ready
 * analysis (AC-1.1) shows its content immediately without waiting for a stream; the
 * snapshot polls while the run is not yet terminal so a fresh run flips to its
 * content the moment it completes. `features` gates the topics / journey views.
 */

const TERMINAL_DB_STATUSES: ReadonlySet<DbStatus> = new Set<DbStatus>([
  'completed',
  'partial',
  'failed',
  'canceled',
]);

export function AnalysisDashboard({ analysisId }: { analysisId: string }): ReactElement {
  const view = useSearch({ strict: false, select: (s) => s.view });

  const statusQuery = useQuery({
    queryKey: ['analysis-status', analysisId],
    queryFn: () => getKeywordAnalysisStatus(analysisId),
    // Poll `GET :id` while the run is not yet terminal (Design §7 cadence) so a
    // just-finished analysis flips to its content; stop once settled (or 404 / error).
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.kind === 'ok' && !TERMINAL_DB_STATUSES.has(data.status.status)) {
        return config.pollIntervalMs;
      }
      return false;
    },
  });

  const snapshot = statusQuery.data;
  if (statusQuery.isPending) {
    return <LoadingState label="載入分析中…" />;
  }
  if (!snapshot || snapshot.kind === 'unavailable') {
    return (
      <ErrorState
        message="無法載入分析狀態，請稍後再試。"
        onRetry={() => void statusQuery.refetch()}
      />
    );
  }
  if (snapshot.kind === 'not_found') {
    return <AnalysisNotFound />;
  }

  const { status, features } = snapshot.status;
  if (status === 'completed' || status === 'partial') {
    return <ViewContent analysisId={analysisId} view={view} features={features} />;
  }
  // queued / running / failed / canceled → the existing live job-tracking panel.
  return <JobTrackingPanel analysisId={analysisId} />;
}
