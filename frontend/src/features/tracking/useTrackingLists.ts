import { type Dispatch, type SetStateAction, useState } from 'react';
import type { TrackingListSummary } from '../../api/trackingLists';

/**
 * NOT-IMPLEMENTED SHELL (T5.7 red). Real fetch lands in the green commit — this
 * shell exists only so the red tests + consumers typecheck. It never loads.
 */
export interface UseTrackingLists {
  readonly lists: TrackingListSummary[];
  readonly setLists: Dispatch<SetStateAction<TrackingListSummary[]>>;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly reload: () => Promise<void>;
}

export function useTrackingLists(): UseTrackingLists {
  const [lists, setLists] = useState<TrackingListSummary[]>([]);
  return { lists, setLists, loading: false, failed: false, reload: async () => {} };
}
