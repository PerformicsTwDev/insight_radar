import type { ReactElement } from 'react';
import type { FilterFieldKey } from '../../../lib/filterSpec';

/**
 * T2.5 red shell — the real router-bound container (URL `filters` param ↔ codec)
 * is implemented green next. Renders nothing so the TC-17 sync assertions fail (red).
 */
export function KeywordsFilters(_props: {
  readonly allowedFilters?: readonly FilterFieldKey[];
}): ReactElement | null {
  return null;
}
