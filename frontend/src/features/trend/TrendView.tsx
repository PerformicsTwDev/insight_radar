import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { z } from 'zod';
import { postQuery } from '../../api/query';
import { ErrorState, LoadingState } from '../../components/StateViews';
import { config } from '../../config/env';
import type { KeywordSeriesInput } from '../../lib/trendSeries';
import { TrendChart } from './TrendChart';

/**
 * Trend-chart container (T6.0, FR-5; M7-R3). Fetches `POST :id/query {view:'trend'}` for the
 * backend `axis` + `total` aggregate line (the frontend never re-derives months — C10), AND —
 * separately — the top-N keywords' `monthlyVolumes` via `POST :id/query {view:'keywords'}` (the
 * SPEC path for per-keyword series, AC-5.1; `GET /keywords` stays lean, AC-6.1). Those feed the
 * 篩選搜尋詞 multi-select so a term can actually be added as its own line. Async states render at
 * a **consistent card height** (T7.4 fidelity).
 */

const TREND_CARD = 'flex min-h-[22rem] flex-col rounded-xl bg-bg-card p-4 ring-1 ring-white/10';

/** One month of a keyword's series from the `keywords` view (backend `MonthlySearchVolume`). */
const MonthlyVolumeSchema = z.object({
  year: z.number(),
  month: z.number(),
  searches: z.number().nullable(),
});
const TrendKeywordRowSchema = z.object({
  text: z.string(),
  monthlyVolumes: z.array(MonthlyVolumeSchema).default([]),
});

/** Map the generic `keywords`-view rows → the trend's `{ keyword, volumes }` (drops unparseable rows). */
function toKeywordSeries(rows: readonly Record<string, unknown>[]): KeywordSeriesInput[] {
  return rows.flatMap((row) => {
    const parsed = TrendKeywordRowSchema.safeParse(row);
    return parsed.success
      ? [{ keyword: parsed.data.text, volumes: parsed.data.monthlyVolumes }]
      : [];
  });
}

export function TrendView({ analysisId }: { analysisId: string }): ReactElement {
  const trendQuery = useQuery({
    queryKey: ['trend', analysisId],
    queryFn: () => postQuery(analysisId, { view: 'trend' }),
  });

  // Top-N keywords (by volume) with their monthly series — the selectable lines for the popover.
  // Its own failure/empty just leaves the popover empty; the aggregate line still renders.
  const seriesQuery = useQuery({
    queryKey: ['trend-keywords', analysisId, config.defaultPageSize],
    queryFn: () =>
      postQuery(analysisId, {
        view: 'keywords',
        select: ['text', 'monthlyVolumes'],
        sort: [{ field: 'avgMonthlySearches', direction: 'desc' }],
        pagination: { page: 1, pageSize: config.defaultPageSize },
      }),
  });

  if (trendQuery.isPending) {
    return (
      <div className={TREND_CARD}>
        <LoadingState label="載入搜尋趨勢…" />
      </div>
    );
  }
  const result = trendQuery.data;
  if (!result || !result.ok || result.view.kind !== 'trend') {
    return (
      <div className={TREND_CARD}>
        <ErrorState
          message="無法載入搜尋趨勢，請稍後再試。"
          onRetry={() => void trendQuery.refetch()}
        />
      </div>
    );
  }

  const { axis, total } = result.view;
  const seriesResult = seriesQuery.data;
  const keywords =
    seriesResult && seriesResult.ok && seriesResult.view.kind === 'table'
      ? toKeywordSeries(seriesResult.view.rows)
      : [];
  return <TrendChart axis={axis} total={total} keywords={keywords} />;
}
