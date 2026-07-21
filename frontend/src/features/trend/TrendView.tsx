import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { postQuery } from '../../api/query';
import { ErrorState, LoadingState } from '../../components/StateViews';
import { TrendChart } from './TrendChart';

/**
 * Trend-chart container (T6.0, FR-5). Fetches `POST :id/query {view:'trend'}` and
 * feeds the presentational {@link TrendChart} the backend `axis` + `total`
 * aggregate line — the frontend never re-derives months (C10). Async states go
 * through the shared StateViews (T6.1).
 *
 * The per-keyword multi-line selection is driven by the keywords list's
 * `monthlyVolumes` (Design §7 — a single top-N `GET /keywords`, not the trend view's
 * pre-aligned points), which the list DTO does not emit yet (documented cross-spec
 * gap in `api/keywords`); the popover therefore starts empty and the aggregate line
 * renders now. Wiring the top-N series is a follow-up once the backend emits it.
 */
export function TrendView({ analysisId }: { analysisId: string }): ReactElement {
  const query = useQuery({
    queryKey: ['trend', analysisId],
    queryFn: () => postQuery(analysisId, { view: 'trend' }),
  });

  if (query.isPending) {
    return <LoadingState label="載入搜尋趨勢…" />;
  }
  const result = query.data;
  if (!result || !result.ok || result.view.kind !== 'trend') {
    return (
      <ErrorState message="無法載入搜尋趨勢，請稍後再試。" onRetry={() => void query.refetch()} />
    );
  }
  const { axis, total } = result.view;
  return <TrendChart axis={axis} total={total} keywords={[]} />;
}
