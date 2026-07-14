import { MIN_TREND_POINTS, toSeriesValues, type MonthlyVolumePoint } from './sparkline';

/** Trend classification + % (T2.3, FR-21). — RED STUB — */

export type TrendType = 'decline' | 'stable' | 'growth' | 'surge';

export type TrendClassification =
  | { readonly kind: 'data'; readonly type: TrendType; readonly percent: number }
  | { readonly kind: 'no_data' };

export function trendPercent(_values: readonly (number | null)[]): number | null {
  throw new Error('not implemented');
}

export function classifyTrend(_percent: number, _stableMax: number, _surgeMin: number): TrendType {
  throw new Error('not implemented');
}

export function classifySeries(
  _volumes: readonly MonthlyVolumePoint[],
  _stableMax: number,
  _surgeMin: number,
): TrendClassification {
  throw new Error('not implemented');
}

// keep imports referenced until the green impl uses them
void MIN_TREND_POINTS;
void toSeriesValues;
