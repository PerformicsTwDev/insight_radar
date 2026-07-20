import type { ReactElement } from 'react';

/** RED shell (T5.2) — replaced by the real metadata-driven table in green. */
export interface CustomClassifyTableProps {
  readonly analysisId: string;
  readonly cid: string;
}

export function CustomClassifyTable(_props: CustomClassifyTableProps): ReactElement {
  return <span />;
}
