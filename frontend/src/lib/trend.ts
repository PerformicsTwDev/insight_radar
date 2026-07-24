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

/** zh display label per trend type — the single wording source for the FR-21 tooltip. */
export const TREND_TYPE_ZH: Record<TrendType, string> = {
  decline: '回落型',
  stable: '穩定型',
  growth: '成長型',
  surge: '爆發型',
};

/**
 * Per-type display colour SSOT (M7-R2a, FR-21). **JS-authoritative**, mirrors the
 * `@theme --color-trend-*` tokens in `src/index.css` (change one → change both, C2 — same
 * discipline as {@link intentMap}). Applied inline on the `搜尋趨勢TTM` cell's signed-% so a
 * label→colour lookup needn't be JIT-safelisted into a purge-unsafe dynamic Tailwind class.
 */
export const TREND_TYPE_COLOR: Record<TrendType, string> = {
  decline: '#ef6f6c', // --color-trend-negative
  stable: '#9aa0a6', // --color-trend-stable
  growth: '#52b788', // --color-trend-growth (= brand green)
  surge: '#f4845f', // --color-trend-surge
};

/**
 * Inline `搜尋趨勢TTM` display (M7-R2a, FR-21): `{ text, type }` for a classifiable series,
 * else `null` (the cell then shows `—`, never a fabricated %). `text` is a glance value —
 * a directional arrow by sign (`↑` >0 / `↓` <0 / none at 0) + the **integer** magnitude %
 * (`↑100%` / `↓20%` / `0%`); the precise 1-dp reading stays in {@link trendTooltip}. `type`
 * drives the cell colour via {@link TREND_TYPE_COLOR}.
 */
export function trendInline(
  volumes: readonly MonthlyVolumePoint[],
  stableMax: number,
  surgeMin: number,
): { readonly text: string; readonly type: TrendType } | null {
  const classification = classifySeries(volumes, stableMax, surgeMin);
  if (classification.kind === 'no_data') {
    return null;
  }
  const { percent, type } = classification;
  const arrow = percent > 0 ? '↑' : percent < 0 ? '↓' : '';
  return { text: `${arrow}${Math.abs(Math.round(percent))}%`, type };
}

/**
 * FR-21 hover-tooltip text for a monthly series: `"<型別> <±%>"` (e.g. `成長型
 * +12.5%`), or `null` when the series has no classifiable trend (< 2 non-null /
 * all-null / first non-null is 0). The % is 1-dp with an explicit sign so a flat
 * or growing trend reads `+`; a declining one already carries its `-`.
 */
export function trendTooltip(
  volumes: readonly MonthlyVolumePoint[],
  stableMax: number,
  surgeMin: number,
): string | null {
  const classification = classifySeries(volumes, stableMax, surgeMin);
  if (classification.kind === 'no_data') {
    return null;
  }
  const sign = classification.percent >= 0 ? '+' : '';
  return `${TREND_TYPE_ZH[classification.type]} ${sign}${classification.percent.toFixed(1)}%`;
}
