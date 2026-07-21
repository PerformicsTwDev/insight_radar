import { describe, expect, it } from 'vitest';
import {
  alignSeriesToAxis,
  assembleVolumeChart,
  formatFetchedAt,
  rangeToFrom,
  type VolumeMemberInput,
} from './volumeSeries';

/**
 * TC-30 (core, C11; FR-19 → backend FR-30 / Design §9.2) — the `fetchedAt`-axis
 * series assembly that feeds the tracking detail line chart. This is the pure C11
 * single-point: X = observation timepoint `fetchedAt` (NOT a month bucket, so it is
 * deliberately distinct from the month-axis `trendSeries`). It must honour backend
 * §9.2 semantics verbatim: the aggregate `total` line is continuous (backend already
 * 0-fills all-missing points), each member line breaks (null) at a missing
 * observation (never 0), and an empty axis draws NOTHING (never a fake 0 line).
 */

const AGGREGATE = { label: '全部成員加總', color: '#52b788', fillColor: 'rgba(82,183,136,0.15)' };
const PALETTE = ['#5bc0eb', '#f4845f', '#ffd166'];

const AXIS = ['2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'];

const member = (key: string, points: [string, number | null][]): VolumeMemberInput => ({
  key,
  label: key,
  series: points.map(([fetchedAt, avgMonthlySearches]) => ({ fetchedAt, avgMonthlySearches })),
});

describe('TC-30 · formatFetchedAt (UTC observation label)', () => {
  it('renders a Z ISO timepoint as its UTC YYYY-MM-DD', () => {
    expect(formatFetchedAt('2026-03-01T00:00:00.000Z')).toBe('2026-03-01');
  });

  it('normalises an offset ISO to the UTC date (not the local date)', () => {
    // 2026-03-01T07:00+08:00 == 2026-02-28T23:00Z → UTC date is the 28th.
    expect(formatFetchedAt('2026-03-01T07:00:00+08:00')).toBe('2026-02-28');
  });

  it('falls back to the raw string when the value is not a valid date', () => {
    expect(formatFetchedAt('not-a-date')).toBe('not-a-date');
  });
});

describe('TC-30 · alignSeriesToAxis (C11 fetchedAt-key alignment)', () => {
  it('maps each axis point to its observation value', () => {
    const series = [
      { fetchedAt: AXIS[0], avgMonthlySearches: 100 },
      { fetchedAt: AXIS[1], avgMonthlySearches: 120 },
      { fetchedAt: AXIS[2], avgMonthlySearches: 140 },
    ];
    expect(alignSeriesToAxis(series, AXIS)).toEqual([100, 120, 140]);
  });

  it('breaks (null) at an axis point the member lacks — never 0 (AC-30.2)', () => {
    const series = [
      { fetchedAt: AXIS[0], avgMonthlySearches: 100 },
      { fetchedAt: AXIS[2], avgMonthlySearches: 140 },
    ];
    expect(alignSeriesToAxis(series, AXIS)).toEqual([100, null, 140]);
  });

  it('keeps a genuine 0 (not coerced to a break)', () => {
    const series = [{ fetchedAt: AXIS[0], avgMonthlySearches: 0 }];
    expect(alignSeriesToAxis(series, AXIS)).toEqual([0, null, null]);
  });

  it('passes a null observation through as a break', () => {
    const series = [{ fetchedAt: AXIS[0], avgMonthlySearches: null }];
    expect(alignSeriesToAxis(series, AXIS)).toEqual([null, null, null]);
  });

  it('drops a series point that is not on the axis (axis authoritative)', () => {
    const series = [
      { fetchedAt: '2025-12-01T00:00:00.000Z', avgMonthlySearches: 999 },
      { fetchedAt: AXIS[1], avgMonthlySearches: 120 },
    ];
    expect(alignSeriesToAxis(series, AXIS)).toEqual([null, 120, null]);
  });
});

describe('TC-30 · assembleVolumeChart (aggregate + selected member lines)', () => {
  it('returns the identifiable empty state for an empty axis — no fake 0 line (AC-30.3)', () => {
    const result = assembleVolumeChart({
      axis: [],
      total: [],
      members: [member('running shoes', [])],
      palette: PALETTE,
      aggregate: AGGREGATE,
    });
    expect(result).toEqual({ isEmpty: true });
  });

  it('draws the aggregate line (total verbatim, area fill) and UTC labels', () => {
    const result = assembleVolumeChart({
      axis: AXIS,
      total: [300, 250, 400],
      members: [],
      palette: PALETTE,
      aggregate: AGGREGATE,
    });
    expect(result.isEmpty).toBe(false);
    if (result.isEmpty) return;
    expect(result.labels).toEqual(['2026-01-01', '2026-03-01', '2026-05-01']);
    expect(result.datasets).toHaveLength(1);
    expect(result.datasets[0].label).toBe('全部成員加總');
    // total passed through verbatim (backend already 0-fills all-missing points, §9.2).
    expect(result.datasets[0].data).toEqual([300, 250, 400]);
    expect(result.datasets[0].fill).toBe(true);
  });

  it('adds one axis-aligned line per selected member with null breaks + colour cycle', () => {
    const result = assembleVolumeChart({
      axis: AXIS,
      total: [300, 250, 400],
      members: [
        member('running shoes', [
          [AXIS[0], 100],
          [AXIS[2], 140],
        ]),
        member('trail shoes', [[AXIS[1], 50]]),
      ],
      palette: PALETTE,
      aggregate: AGGREGATE,
    });
    expect(result.isEmpty).toBe(false);
    if (result.isEmpty) return;
    expect(result.datasets).toHaveLength(3);
    // aggregate stays first.
    expect(result.datasets[0].label).toBe('全部成員加總');
    // member lines aligned to the shared fetchedAt axis, null break where absent (C11 + AC-30.2).
    expect(result.datasets[1].label).toBe('running shoes');
    expect(result.datasets[1].data).toEqual([100, null, 140]);
    expect(result.datasets[1].fill).toBe(false);
    expect(result.datasets[1].borderColor).toBe(PALETTE[0]);
    expect(result.datasets[2].label).toBe('trail shoes');
    expect(result.datasets[2].data).toEqual([null, 50, null]);
    expect(result.datasets[2].borderColor).toBe(PALETTE[1]);
  });

  it('treats an omitted members list as no member lines (aggregate only)', () => {
    const result = assembleVolumeChart({
      axis: AXIS,
      total: [1, 2, 3],
      palette: PALETTE,
      aggregate: AGGREGATE,
    });
    expect(result.isEmpty).toBe(false);
    if (result.isEmpty) return;
    expect(result.datasets).toHaveLength(1);
  });
});

describe('TC-30 · rangeToFrom (6M / 12M / all window)', () => {
  const NOW = new Date('2026-07-15T00:00:00.000Z');

  it('6m → now minus 6 months (UTC)', () => {
    expect(rangeToFrom('6m', NOW)).toBe('2026-01-15T00:00:00.000Z');
  });

  it('12m → now minus 12 months (UTC)', () => {
    expect(rangeToFrom('12m', NOW)).toBe('2025-07-15T00:00:00.000Z');
  });

  it('all → undefined (no lower bound)', () => {
    expect(rangeToFrom('all', NOW)).toBeUndefined();
  });
});
