import type { ReactElement } from 'react';
import type { JobState } from '../../lib/jobState';

/** Presentational job-progress view (T1.3, TC-14). Pure: driven entirely by {@link JobState}. */
export function JobProgress(_props: { state: JobState; onCancel?: () => void }): ReactElement {
  return <div />;
}
