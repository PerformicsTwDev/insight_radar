import type { ReactElement } from 'react';

export interface ViewContentProps {
  readonly analysisId: string;
  readonly view: string | undefined;
  readonly features: unknown;
}

/** STUB (T6.0 red) — real implementation lands in the green commit. */
export function ViewContent(_props: ViewContentProps): ReactElement {
  return <div data-testid="view-content-stub" />;
}
