import type { ReactElement } from 'react';
import type { FilterFieldKey, FilterSpec } from '../../../lib/filterSpec';

/**
 * T2.5 red shell — real chips popover UI is implemented green next. Typed props so
 * the TC-17 spec compiles; renders nothing so the assertions fail (red).
 */
export interface FilterBarProps {
  readonly allowedFilters: readonly FilterFieldKey[];
  readonly value: FilterSpec;
  readonly onChange: (next: FilterSpec) => void;
}

export function FilterBar(_props: FilterBarProps): ReactElement | null {
  return null;
}
