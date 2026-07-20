import type { ReactElement } from 'react';
import type { EventSourceFactory } from '../job/useJobTracking';

/** RED shell (T5.2) — replaced by the real container in green. */
export interface CustomClassifyViewProps {
  readonly analysisId: string;
  readonly eventSourceFactory?: EventSourceFactory;
}

export function CustomClassifyView(_props: CustomClassifyViewProps): ReactElement {
  return <span />;
}
