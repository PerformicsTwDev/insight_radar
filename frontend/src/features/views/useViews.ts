import { useQuery } from '@tanstack/react-query';
import { fetchViews } from '../../api/views';
import {
  FALLBACK_REGISTRY,
  resolveViewRegistry,
  type ResolvedRegistry,
} from '../../lib/viewRegistry';

/**
 * TanStack Query hook exposing the view registry (T3.1, FR-1 / AC-1.2). Fetches
 * `GET /views` once (server state → Query cache) and resolves it to `{ registry,
 * degraded }` via the pure {@link resolveViewRegistry}. `fetchViews` never throws
 * (it returns `ok:false` on any failure), so the hook never surfaces a query
 * error — a `/views` failure degrades to the built-in fallback list.
 */

/** Stable query key for the app-wide view registry. */
export const VIEWS_QUERY_KEY = ['views'] as const;

export function useViews(): ResolvedRegistry {
  const { data } = useQuery({ queryKey: VIEWS_QUERY_KEY, queryFn: fetchViews });
  // While pending (no data yet) show the built-in list WITHOUT the degraded hint —
  // degradation is a settled failure, not a first-render loading flash.
  if (!data) {
    return { registry: FALLBACK_REGISTRY, degraded: false };
  }
  return resolveViewRegistry(data);
}
