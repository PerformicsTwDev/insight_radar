import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SPARKLINE_DIMENSIONS,
  buildSparkline,
  toSeriesValues,
  type MonthlyVolumePoint,
  type SparklineResult,
} from './sparkline';

/**
 * TC-7 — sparkline: monthlyVolumes → points; a missing month is a `null` break,
 * never plotted as 0 (C12); series < 2 non-null points / all-null → no data
 * (FR-21); months are never synthesised (C10 — the transform reads `searches`
 * only). Small custom dims give exact, integer coordinates to assert against.
 */
const DIMS = { width: 100, height: 30, padding: 0 };

/** A month cell carrying only `searches` — proves the transform never reads year/month (C10). */
const vol = (searches: number | null): MonthlyVolumePoint => ({ searches });

/** Narrowing helper: assert the result has data and hand back its geometry. */
function geometryOf(result: SparklineResult) {
  expect(result.hasData).toBe(true);
  if (!result.hasData) {
    throw new Error('expected hasData=true');
  }
  return result.geometry;
}

describe('TC-7 · toSeriesValues (shared series seam for T2.2 + T2.3)', () => {
  it('extracts searches in order, keeping missing months null (never 0, C12)', () => {
    expect(toSeriesValues([vol(10), vol(null), vol(30)])).toEqual([10, null, 30]);
  });

  it('reads searches only — ignores year/month, so months cannot be synthesised (C10)', () => {
    const withMonths = [
      { year: 2026, month: 3, searches: 5 },
      { year: 2026, month: 1, searches: 9 },
    ];
    // Order is preserved as-emitted (no re-sort by month); only `searches` is read.
    expect(toSeriesValues(withMonths)).toEqual([5, 9]);
  });
});

describe('TC-7 · buildSparkline (monthlyVolumes → SVG geometry)', () => {
  it('maps a fully-present series to a single scaled polyline segment', () => {
    const geometry = geometryOf(buildSparkline([vol(0), vol(30)], DIMS));
    expect(geometry.width).toBe(100);
    expect(geometry.height).toBe(30);
    // min=0 (bottom, y=height), max=30 (top, y=0); x spans the full width.
    expect(geometry.segments).toEqual([
      [
        { x: 0, y: 30 },
        { x: 100, y: 0 },
      ],
    ]);
  });

  it('breaks the line at a missing month into separate segments (gap, never a 0 dip)', () => {
    const geometry = geometryOf(
      buildSparkline([vol(0), vol(10), vol(null), vol(20), vol(30)], DIMS),
    );
    // Two segments split at index 2 (the null); x uses the FULL series index so the
    // gap is a real horizontal hole where the null month sits — not a plotted 0.
    expect(geometry.segments).toEqual([
      [
        { x: 0, y: 30 },
        { x: 25, y: 20 },
      ],
      [
        { x: 75, y: 10 },
        { x: 100, y: 0 },
      ],
    ]);
  });

  it('does not open a segment for a leading null month', () => {
    const geometry = geometryOf(buildSparkline([vol(null), vol(10), vol(20)], DIMS));
    // Only one segment; the leading null contributes nothing (no phantom 0 point).
    expect(geometry.segments).toEqual([
      [
        { x: 50, y: 30 },
        { x: 100, y: 0 },
      ],
    ]);
  });

  it('closes the trailing segment at a final null month without a phantom point', () => {
    const geometry = geometryOf(buildSparkline([vol(10), vol(20), vol(null)], DIMS));
    expect(geometry.segments).toEqual([
      [
        { x: 0, y: 30 },
        { x: 50, y: 0 },
      ],
    ]);
  });

  it('draws a flat mid-height line when every non-null value is equal (no divide-by-zero)', () => {
    const geometry = geometryOf(buildSparkline([vol(5), vol(5), vol(5)], DIMS));
    // max === min → all points sit at the vertical middle (height / 2).
    expect(geometry.segments).toEqual([
      [
        { x: 0, y: 15 },
        { x: 50, y: 15 },
        { x: 100, y: 15 },
      ],
    ]);
  });

  it('returns { hasData: false } for a single non-null point (< 2 valid points)', () => {
    expect(buildSparkline([vol(null), vol(42), vol(null)], DIMS)).toEqual({ hasData: false });
  });

  it('returns { hasData: false } for an all-null series (never a 0 line)', () => {
    expect(buildSparkline([vol(null), vol(null)], DIMS)).toEqual({ hasData: false });
  });

  it('returns { hasData: false } for an empty series (backend emitted [])', () => {
    expect(buildSparkline([], DIMS)).toEqual({ hasData: false });
  });

  it('falls back to the default viewBox dimensions when none are given', () => {
    const geometry = geometryOf(buildSparkline([vol(1), vol(2)]));
    expect(geometry.width).toBe(DEFAULT_SPARKLINE_DIMENSIONS.width);
    expect(geometry.height).toBe(DEFAULT_SPARKLINE_DIMENSIONS.height);
  });
});
