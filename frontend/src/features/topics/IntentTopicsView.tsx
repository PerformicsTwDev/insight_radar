import type { ReactElement } from 'react';
import type { EventSourceFactory } from '../job/useJobTracking';

export interface IntentTopicsViewProps {
  readonly analysisId: string;
  readonly features: unknown;
  readonly eventSourceFactory?: EventSourceFactory;
}

/** RED stub (T3.3): not implemented — renders a placeholder so TC-19 gate flow fails. */
export function IntentTopicsView(_props: IntentTopicsViewProps): ReactElement {
  return <div>intent-topics-view-todo</div>;
}
