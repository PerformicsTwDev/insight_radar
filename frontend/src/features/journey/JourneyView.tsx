import type { ReactElement } from 'react';
import type { EventSourceFactory } from '../job/useJobTracking';

export interface JourneyViewProps {
  readonly analysisId: string;
  readonly features: unknown;
  readonly eventSourceFactory?: EventSourceFactory;
}

/** RED stub (T4.4): not implemented — renders a placeholder so TC-25 gate flow fails. */
export function JourneyView(_props: JourneyViewProps): ReactElement {
  return <div>journey-view-todo</div>;
}
