import { useNavigate, useSearch } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import {
  deserializeFiltersFromUrl,
  serializeFiltersToUrl,
  type FilterFieldKey,
  type FilterSpec,
} from '../../../lib/filterSpec';
import { DEFAULT_ALLOWED_FILTERS } from './filterFields';
import { FilterBar } from './FilterBar';

/**
 * Router-bound filter container (T2.5, FR-6 / FR-1). Binds the controlled
 * {@link FilterBar} to the URL `filters` search param through the single codec +
 * `urlState` (Design §5 「URL 即狀態」): the param is deserialized to the current
 * `FilterSpec` (never throws — a malformed param normalises to no-filter), and an
 * apply / clear serializes the next spec back into the URL (dropped entirely when
 * empty, so a cleared state leaves no `filters` param). This is the state that
 * drives the `/keywords` + `/query` filters once the data hook lands (T2.6/T3.1).
 */
export function KeywordsFilters({
  allowedFilters,
}: {
  readonly allowedFilters?: readonly FilterFieldKey[];
}): ReactElement {
  const navigate = useNavigate();
  const filtersRaw = useSearch({ strict: false, select: (s) => s.filters });
  const value = deserializeFiltersFromUrl(filtersRaw);

  function handleChange(next: FilterSpec): void {
    const serialized = serializeFiltersToUrl(next);
    void navigate({
      to: '.',
      search: (prev) => ({ ...prev, filters: serialized === '' ? undefined : serialized }),
    });
  }

  return (
    <FilterBar
      allowedFilters={allowedFilters ?? DEFAULT_ALLOWED_FILTERS}
      value={value}
      onChange={handleChange}
    />
  );
}
