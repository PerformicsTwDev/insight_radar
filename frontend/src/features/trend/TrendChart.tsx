import { type ReactElement } from 'react';
import type { KeywordSeriesInput, TooltipRow } from '../../lib/trendSeries';

/**
 * Trend line chart (T2.4, FR-5). Default aggregate line (brand green, area fill)
 * from the trend view's `axis` + `total`; a "篩選搜尋詞" popover multi-select adds
 * one axis-aligned line per keyword (10-colour cycle) with an external HTML
 * tooltip for the multi-line case. THIN component: every data transform lives in
 * the pure `lib/trendSeries` (tested there); jsdom can't render canvas, so the
 * component test mocks `chart.js` and asserts the assembled datasets.
 */

// STUB (red): typed not-implemented shell. Real implementation lands in green.

export interface TrendChartProps {
  readonly axis: readonly string[];
  readonly total: readonly number[];
  readonly keywords: readonly KeywordSeriesInput[];
}

/** Neutral tooltip view-model (decoupled from Chart.js), fed to {@link updateTooltipEl}. */
export interface TrendTooltipModel {
  readonly visible: boolean;
  readonly title: string;
  readonly rows: TooltipRow[];
}

export function TrendChart(_props: TrendChartProps): ReactElement {
  return <div data-testid="trend-chart-stub" />;
}

export function getTooltipEl(_canvas: HTMLCanvasElement): HTMLElement {
  return document.createElement('div');
}

export function toTrendTooltipModel(_tooltip: unknown): TrendTooltipModel {
  return { visible: false, title: '', rows: [] };
}

export function updateTooltipEl(_el: HTMLElement, _model: TrendTooltipModel): void {
  // stub
}
