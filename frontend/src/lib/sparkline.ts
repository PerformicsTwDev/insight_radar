/**
 * Pure sparkline geometry (T2.2, FR-4 → FR-21). Transforms an ordered monthly
 * search-volume series into SVG polyline segments — **no React, no IO** (core ≥90).
 *
 * Correctness single-points it must honour:
 * - **C12 (null 不補 0)**: a missing month (`searches === null`) is a genuine
 *   **break** in the line, split into a separate segment — never plotted as 0.
 * - **序列 < 2 有效點 / 全 null → 無資料** (FR-21): the cell renders `—`, not a
 *   flat 0 line.
 * - **C10 (不自推月份)**: the x-axis is the array **position** in the series as
 *   emitted by the backend; this module never reads `year`/`month`, so it cannot
 *   synthesise or reorder months (it depends structurally on `searches` alone).
 */

/** Minimal month-series element the sparkline depends on (the API row's `monthlyVolumes` is assignable). */
export interface MonthlyVolumePoint {
  readonly searches: number | null;
}

/** A plotted point inside the sparkline viewBox. */
export interface SparklinePoint {
  readonly x: number;
  readonly y: number;
}

/** ViewBox geometry for the self-drawn SVG sparkline (fixed presentational constants). */
export interface SparklineDimensions {
  readonly width: number;
  readonly height: number;
  readonly padding: number;
}

/** Default sparkline viewBox (presentational; not config — spec §14 lists no sparkline size). */
export const DEFAULT_SPARKLINE_DIMENSIONS: SparklineDimensions = {
  width: 96,
  height: 24,
  padding: 2,
};

/** Minimum non-null points needed to draw a line (shared with T2.3 trend %). */
export const MIN_TREND_POINTS = 2;

/** Round a coordinate to 2 dp — deterministic geometry + clean SVG `points` strings (no float dust). */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Resolved geometry: viewBox + one polyline segment per contiguous run of non-null points. */
export interface SparklineGeometry {
  readonly width: number;
  readonly height: number;
  /** Contiguous runs of non-null points; null months split runs, producing a visible gap. */
  readonly segments: readonly (readonly SparklinePoint[])[];
}

/** `hasData:false` → the cell renders the no-data marker (never a 0 line). */
export type SparklineResult =
  { readonly hasData: true; readonly geometry: SparklineGeometry } | { readonly hasData: false };

/**
 * Shared series-value extraction (T2.2 sparkline **and** T2.3 trend %): monthly
 * volumes → ordered `searches` values, nulls kept verbatim (C12, never 0). The
 * array index is the series position (C10 — months are not synthesised).
 */
export function toSeriesValues(volumes: readonly MonthlyVolumePoint[]): (number | null)[] {
  return volumes.map((point) => point.searches);
}

/**
 * Map a non-null value into the viewBox: higher value → smaller `y` (SVG y grows
 * downward). A flat series (`max === min`) sits at the vertical middle so a
 * single repeated value never divides by zero nor collapses to the top/bottom.
 */
function scaleY(value: number, min: number, max: number, dimensions: SparklineDimensions): number {
  if (max === min) {
    return dimensions.height / 2;
  }
  const usable = dimensions.height - dimensions.padding * 2;
  const ratio = (value - min) / (max - min);
  return dimensions.padding + (1 - ratio) * usable;
}

/**
 * Build SVG polyline geometry from a monthly series. < 2 non-null points (or all
 * null) → `{ hasData: false }`. Otherwise, non-null runs become polyline segments
 * split across null gaps (C12) scaled into the given viewBox.
 */
export function buildSparkline(
  volumes: readonly MonthlyVolumePoint[],
  dimensions: SparklineDimensions = DEFAULT_SPARKLINE_DIMENSIONS,
): SparklineResult {
  const values = toSeriesValues(volumes);
  const nonNull = values.filter((value): value is number => value !== null);
  // 序列 < 2 有效點 / 全 null / 空 → 無資料（不強行畫線；C12 絕不補 0）。
  if (nonNull.length < MIN_TREND_POINTS) {
    return { hasData: false };
  }

  const min = Math.min(...nonNull);
  const max = Math.max(...nonNull);
  // x uses the FULL series index (>= 2 non-null ⇒ length >= 2 ⇒ divisor >= 1), so a
  // null month leaves a genuine horizontal gap where its position sits — not a 0 dip.
  const lastIndex = values.length - 1;

  const segments: SparklinePoint[][] = [];
  let current: SparklinePoint[] = [];
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === null) {
      // 缺月＝斷點：收束目前線段（若有），下一非空值另起新線段。
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }
    current.push({
      x: round((index / lastIndex) * dimensions.width),
      y: round(scaleY(value, min, max, dimensions)),
    });
  }
  if (current.length > 0) {
    segments.push(current);
  }

  return {
    hasData: true,
    geometry: { width: dimensions.width, height: dimensions.height, segments },
  };
}
