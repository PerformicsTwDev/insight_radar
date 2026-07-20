import type { ReactElement } from 'react';

export interface JourneyTableProps {
  readonly rows: readonly Record<string, unknown>[] | undefined;
}

/** RED stub (T4.4): not implemented — renders a placeholder so TC-25 表格 fails. */
export function JourneyTable(_props: JourneyTableProps): ReactElement {
  return <div>journey-table-todo</div>;
}
