import { describe, expect, it } from 'vitest';
import { classifySeries, classifyTrend, trendPercent, trendTooltip, type TrendType } from './trend';
import type { MonthlyVolumePoint } from './sparkline';

/**
 * TC-1 / TC-2 — trend classification + % (FR-21). Thresholds are **left-closed /
 * right-open** and come from config (passed as params here so the pure function
 * stays testable and free of magic numbers, C1): `<0`→decline, `[0,stableMax)`→
 * stable, `[stableMax,surgeMin)`→growth, `[surgeMin,∞)`→surge. Defaults 5 / 20.
 */

const STABLE_MAX = 5;
const SURGE_MIN = 20;

/** Build a monthlyVolumes array from a searches series (year/month are ignored by C10). */
const vol = (searches: (number | null)[]): MonthlyVolumePoint[] =>
  searches.map((s) => ({ searches: s }));

describe('TC-1 · classifyTrend (門檻左閉右開)', () => {
  const cases: { pct: number; type: TrendType }[] = [
    { pct: -3, type: 'decline' },
    { pct: 0, type: 'stable' }, // 0 ∈ [0, 5) → stable (left-closed)
    { pct: 4.9, type: 'stable' },
    { pct: 5, type: 'growth' }, // 5 ∈ [5, 20) → growth (left-closed, not stable)
    { pct: 19.9, type: 'growth' },
    { pct: 20, type: 'surge' }, // 20 ∈ [20, ∞) → surge (left-closed, not growth)
    { pct: 35, type: 'surge' },
  ];
  for (const { pct, type } of cases) {
    it(`${pct}% → ${type}`, () => {
      expect(classifyTrend(pct, STABLE_MAX, SURGE_MIN)).toBe(type);
    });
  }

  it('is driven by the passed thresholds, not hardcoded (config-parameterised, C1)', () => {
    // With a wider stable band [0,10) the same 5% is stable, not growth.
    expect(classifyTrend(5, 10, 30)).toBe('stable');
    // With a lower surge floor 4, 5% is already a surge.
    expect(classifyTrend(5, 2, 4)).toBe('surge');
  });
});

describe('TC-2 · trendPercent (首末非空點；退化 → null)', () => {
  it('computes (last-first)/first*100 from the first & last non-null points', () => {
    expect(trendPercent([100, 150])).toBeCloseTo(50);
    expect(trendPercent([200, 100])).toBeCloseTo(-50); // decline
    expect(trendPercent([100, 250])).toBeCloseTo(150); // surge
  });

  it('uses first/last NON-null, ignoring null endpoints and gaps (never treats null as 0)', () => {
    expect(trendPercent([null, 100, null, 250, null])).toBeCloseTo(150);
  });

  it('returns null for < 2 non-null points', () => {
    expect(trendPercent([100])).toBeNull();
    expect(trendPercent([null, 100, null])).toBeNull();
  });

  it('returns null for an all-null or empty series', () => {
    expect(trendPercent([null, null])).toBeNull();
    expect(trendPercent([])).toBeNull();
  });

  it('returns null when the first non-null value is 0 (division by zero → 無資料)', () => {
    expect(trendPercent([0, 100])).toBeNull();
  });
});

describe('TC-1+2 · classifySeries (series → { type, percent } | no_data)', () => {
  it('classifies a valid series via the shared toSeriesValues seam', () => {
    const result = classifySeries(vol([1000, 1125]), STABLE_MAX, SURGE_MIN); // 12.5% → growth
    expect(result.kind).toBe('data');
    if (result.kind === 'data') {
      expect(result.type).toBe('growth');
      expect(result.percent).toBeCloseTo(12.5);
    }
  });

  it('returns no_data for a degenerate series (first non-null = 0)', () => {
    expect(classifySeries(vol([0, 100]), STABLE_MAX, SURGE_MIN)).toEqual({ kind: 'no_data' });
  });

  it('returns no_data for an all-null series', () => {
    expect(classifySeries(vol([null, null]), STABLE_MAX, SURGE_MIN)).toEqual({ kind: 'no_data' });
  });
});

describe('TC-1+21 · trendTooltip (FR-21 sparkline hover text: 型別 + %)', () => {
  it('formats a growth trend with a + sign', () => {
    expect(trendTooltip(vol([1000, 1125]), STABLE_MAX, SURGE_MIN)).toBe('成長型 +12.5%');
  });

  it('formats a surge trend with a + sign', () => {
    expect(trendTooltip(vol([100, 200]), STABLE_MAX, SURGE_MIN)).toBe('爆發型 +100.0%');
  });

  it('formats a decline trend (already negative — no extra +)', () => {
    expect(trendTooltip(vol([200, 100]), STABLE_MAX, SURGE_MIN)).toBe('回落型 -50.0%');
  });

  it('formats a stable trend', () => {
    expect(trendTooltip(vol([100, 103]), STABLE_MAX, SURGE_MIN)).toBe('穩定型 +3.0%');
  });

  it('returns null when the series has no classifiable trend (first non-null 0)', () => {
    expect(trendTooltip(vol([0, 100]), STABLE_MAX, SURGE_MIN)).toBeNull();
  });

  it('returns null for a < 2-point / all-null series', () => {
    expect(trendTooltip(vol([100]), STABLE_MAX, SURGE_MIN)).toBeNull();
    expect(trendTooltip(vol([null, null]), STABLE_MAX, SURGE_MIN)).toBeNull();
  });
});
