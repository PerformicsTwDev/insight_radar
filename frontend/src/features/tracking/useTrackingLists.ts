import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from 'react';
import { listTrackingLists, type TrackingListSummary } from '../../api/trackingLists';

/**
 * Shared tracking-list read hook (T5.7, FR-19; backend FR-28 · AC-28.3). Tracking
 * lists are cross-analysis GLOBAL resources, so both the top-level entry
 * ({@link TrackingListsView}) and — later — the results-page sidebar (#443) read
 * them the same way. This owns the fetch lifecycle (`lists` / `loading` / `failed`
 * / `reload`) over the typed {@link listTrackingLists} egress (never a bare fetch),
 * and exposes `setLists` so a mutating consumer can apply an optimistic
 * create/rename/delete without a refetch round-trip. Never throws — a non-2xx (or a
 * schema-invalid body) degrades to `failed:true` with an empty list.
 */
export interface UseTrackingLists {
  readonly lists: TrackingListSummary[];
  readonly setLists: Dispatch<SetStateAction<TrackingListSummary[]>>;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly reload: () => Promise<void>;
}

export function useTrackingLists(): UseTrackingLists {
  // A plain array (never null) so create/rename/delete mutate cleanly; a separate
  // `loading` flag models the fetch (no nullable state → no dead null-branch).
  const [lists, setLists] = useState<TrackingListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setFailed(false);
    const res = await listTrackingLists();
    setLoading(false);
    if (res.ok) setLists(res.lists);
    else setFailed(true);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { lists, setLists, loading, failed, reload };
}
