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

// TDD red 空殼（T2.2）——green commit 才實作真正的幾何轉換。

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

/** Resolved geometry: viewBox + one polyline segment per contiguous run of non-null points. */
export interface SparklineGeometry {
  readonly width: number;
  readonly height: number;
  /** Contiguous runs of non-null points; null months split runs, producing a visible gap. */
  readonly segments: readonly (readonly SparklinePoint[])[];
}

/** `hasData:false` → the cell renders the no-data marker (never a 0 line). */
export type SparklineResult =
  | { readonly hasData: true; readonly geometry: SparklineGeometry }
  | { readonly hasData: false };

/**
 * Shared series-value extraction (T2.2 sparkline **and** T2.3 trend %): monthly
 * volumes → ordered `searches` values, nulls kept verbatim (C12, never 0). The
 * array index is the series position (C10 — months are not synthesised).
 */
export function toSeriesValues(_volumes: readonly MonthlyVolumePoint[]): (number | null)[] {
  throw new Error('not implemented');
}

/**
 * Build SVG polyline geometry from a monthly series. < 2 non-null points (or all
 * null) → `{ hasData: false }`. Otherwise, non-null runs become polyline segments
 * split across null gaps (C12) scaled into the given viewBox.
 */
export function buildSparkline(
  _volumes: readonly MonthlyVolumePoint[],
  _dimensions: SparklineDimensions = DEFAULT_SPARKLINE_DIMENSIONS,
): SparklineResult {
  throw new Error('not implemented');
}
