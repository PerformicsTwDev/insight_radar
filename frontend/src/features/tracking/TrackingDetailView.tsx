import type { ReactElement } from 'react';

export interface TrackingDetailViewProps {
  readonly listId: string;
}

// T5.6 typed shell (red) — real dashboard lands in the green commit.
export function TrackingDetailView(_props: TrackingDetailViewProps): ReactElement {
  return <section aria-label="追蹤清單時序" />;
}
