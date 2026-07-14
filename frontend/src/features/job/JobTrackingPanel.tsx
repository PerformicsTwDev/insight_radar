import type { ReactElement } from 'react';
import { useJobTracking } from './useJobTracking';
import { JobProgress } from './JobProgress';

/**
 * Job-tracking container (T1.3): binds {@link useJobTracking} for `analysisId`
 * and renders the presentational {@link JobProgress} with a live `JobState` +
 * cancel action. This replaces the T1.2 progress placeholder on the home route
 * once an `analysisId` is present in the URL (Design §5 — URL is state).
 */
export function JobTrackingPanel({ analysisId }: { analysisId: string }): ReactElement {
  const { state, cancel } = useJobTracking(analysisId);
  return (
    <section aria-labelledby="job-heading" className="max-w-2xl rounded-2xl bg-bg-card p-6">
      <h2 id="job-heading" className="text-xl font-semibold">
        關鍵字分析
      </h2>
      <p className="mt-2 text-sm text-white/60">追蹤分析工作進度。</p>
      <div className="mt-6">
        <JobProgress
          state={state}
          onCancel={() => {
            void cancel();
          }}
        />
      </div>
    </section>
  );
}
