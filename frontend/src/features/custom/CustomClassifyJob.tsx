import type { ReactElement } from 'react';
import type { EventSourceFactory } from '../job/useJobTracking';

/** RED shell (T5.2) — replaced by the real keyed job tracker in green. */
export interface CustomClassifyJobProps {
  readonly analysisId: string;
  readonly cid: string;
  readonly onDone: (cid: string) => void;
  readonly onFailed: (cid: string) => void;
  readonly eventSourceFactory?: EventSourceFactory;
}

export function CustomClassifyJob(_props: CustomClassifyJobProps): ReactElement {
  return <span />;
}
