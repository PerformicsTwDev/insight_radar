import { MIN_TREND_POINTS, toSeriesValues, type MonthlyVolumePoint } from './sparkline';

/**
 * Pure trend classification + % (T2.3, FR-21; Design §6 C1). **No React / no IO**
 * → core `src/lib/**` (≥90% gate). Reuses the T2.2 series seam
 * ({@link toSeriesValues} / {@link MIN_TREND_POINTS}) so sparkline geometry and
 * trend % agree on what counts as a valid point (C12: a null month is never 0).
 *
 * Thresholds are **left-closed / right-open** and passed in from config (C1 — no
 * magic numbers here): `<0`→decline, `[0,stableMax)`→stable,
 * `[stableMax,surgeMin)`→growth, `[surgeMin,∞)`→surge.
 */

export type TrendType = 'decline' | 'stable' | 'growth' | 'surge';

/** Classified trend, or `no_data` for a degenerate series (never force-classified). */
export type TrendClassification =
  | { readonly kind: 'data'; readonly type: TrendType; readonly percent: number }
  | { readonly kind: 'no_data' };

/**
 * TTM trend % (C1): `(last - first) / first * 100`, where first/last are the
 * **first and last non-null** points. `< 2` non-null points (or all-null / empty)
 * → `null`; a first non-null value of `0` → `null` (division by zero). Null months
 * are ignored, never coerced to 0.
 */
export function trendPercent(values: readonly (number | null)[]): number | null {
  const nonNull = values.filter((value): value is number => value !== null);
  if (nonNull.length < MIN_TREND_POINTS) return null;
  const first = nonNull[0];
  const last = nonNull[nonNull.length - 1];
  if (first === 0) return null;
  return ((last - first) / first) * 100;
}

/**
 * Classify a trend % against config thresholds (left-closed / right-open, C1).
 * `0` is the inherent sign boundary (decline = negative growth), not a tunable.
 */
export function classifyTrend(percent: number, stableMax: number, surgeMin: number): TrendType {
  if (percent < 0) return 'decline';
  if (percent < stableMax) return 'stable';
  if (percent < surgeMin) return 'growth';
  return 'surge';
}

/**
 * Full classification from a monthly series (via the shared {@link toSeriesValues}
 * seam): `{ kind: 'data', type, percent }`, or `{ kind: 'no_data' }` when the
 * series is too short / all-null / first non-null is 0.
 */
export function classifySeries(
  volumes: readonly MonthlyVolumePoint[],
  stableMax: number,
  surgeMin: number,
): TrendClassification {
  const percent = trendPercent(toSeriesValues(volumes));
  if (percent === null) return { kind: 'no_data' };
  return { kind: 'data', type: classifyTrend(percent, stableMax, surgeMin), percent };
}
