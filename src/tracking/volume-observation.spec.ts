import {
  limitToRecentMonths,
  sameObservation,
  type MonthlyVolumePoint,
  type VolumeObservation,
} from './volume-observation';

/**
 * TC-65 部分（FR-29 / AC-29.4 · 正確性單點 S3）：store-on-change 全欄相等純函式 +
 * backfill 月數裁切純函式。**null 不補 0**、`monthlyVolumes` 逐點比對、cpc micros 全欄。
 */
describe('TC-65: sameObservation (store-on-change full-column equality, AC-29.4/S3)', () => {
  const base = (): VolumeObservation => ({
    avgMonthlySearches: 100,
    competition: 'MEDIUM',
    cpcLowMicros: '500000',
    cpcHighMicros: '1500000',
    monthlyVolumes: [
      { year: 2025, month: 1, searches: 90 },
      { year: 2025, month: 2, searches: 110 },
    ],
  });

  it('identical observations → true (same value → skip insert)', () => {
    expect(sameObservation(base(), base())).toBe(true);
  });

  it('all-null observations are equal (null preserved, not coerced to 0)', () => {
    const nulls = (): VolumeObservation => ({
      avgMonthlySearches: null,
      competition: 'UNSPECIFIED',
      cpcLowMicros: null,
      cpcHighMicros: null,
      monthlyVolumes: [],
    });
    expect(sameObservation(nulls(), nulls())).toBe(true);
  });

  it('avgMonthlySearches differs → false', () => {
    expect(sameObservation(base(), { ...base(), avgMonthlySearches: 101 })).toBe(false);
  });

  it('avgMonthlySearches null vs 0 → false (null ≠ 0)', () => {
    expect(
      sameObservation(
        { ...base(), avgMonthlySearches: null },
        { ...base(), avgMonthlySearches: 0 },
      ),
    ).toBe(false);
  });

  it('competition differs → false', () => {
    expect(sameObservation(base(), { ...base(), competition: 'HIGH' })).toBe(false);
  });

  it('cpcLowMicros differs → false', () => {
    expect(sameObservation(base(), { ...base(), cpcLowMicros: '600000' })).toBe(false);
  });

  it('cpcHighMicros differs → false', () => {
    expect(sameObservation(base(), { ...base(), cpcHighMicros: null })).toBe(false);
  });

  it('monthlyVolumes length differs → false', () => {
    expect(
      sameObservation(base(), {
        ...base(),
        monthlyVolumes: [{ year: 2025, month: 1, searches: 90 }],
      }),
    ).toBe(false);
  });

  it('monthlyVolumes searches differ at one point → false', () => {
    expect(
      sameObservation(base(), {
        ...base(),
        monthlyVolumes: [
          { year: 2025, month: 1, searches: 90 },
          { year: 2025, month: 2, searches: 999 },
        ],
      }),
    ).toBe(false);
  });

  it('monthlyVolumes searches null vs 0 at a point → false (null ≠ 0)', () => {
    expect(
      sameObservation(
        { ...base(), monthlyVolumes: [{ year: 2025, month: 1, searches: null }] },
        { ...base(), monthlyVolumes: [{ year: 2025, month: 1, searches: 0 }] },
      ),
    ).toBe(false);
  });

  it('monthlyVolumes year differs (same month/searches) → false', () => {
    expect(
      sameObservation(base(), {
        ...base(),
        monthlyVolumes: [
          { year: 2025, month: 1, searches: 90 },
          { year: 2024, month: 2, searches: 110 },
        ],
      }),
    ).toBe(false);
  });

  it('monthlyVolumes month differs (same year/searches) → false', () => {
    expect(
      sameObservation(base(), {
        ...base(),
        monthlyVolumes: [
          { year: 2025, month: 1, searches: 90 },
          { year: 2025, month: 3, searches: 110 },
        ],
      }),
    ).toBe(false);
  });
});

describe('TC-65: limitToRecentMonths (backfill 近 N 個月, AC-29.1)', () => {
  const series = (): MonthlyVolumePoint[] => [
    { year: 2024, month: 11, searches: 10 },
    { year: 2024, month: 12, searches: 20 },
    { year: 2025, month: 1, searches: 30 },
    { year: 2025, month: 2, searches: null },
  ];

  it('keeps the most recent N months in chronological order', () => {
    expect(limitToRecentMonths(series(), 2)).toEqual([
      { year: 2025, month: 1, searches: 30 },
      { year: 2025, month: 2, searches: null },
    ]);
  });

  it('N >= length → returns all (sorted chronologically), null preserved', () => {
    expect(limitToRecentMonths(series(), 12)).toEqual(series());
  });

  it('sorts unordered input chronologically before trimming', () => {
    const unordered: MonthlyVolumePoint[] = [
      { year: 2025, month: 2, searches: 40 },
      { year: 2024, month: 12, searches: 20 },
      { year: 2025, month: 1, searches: 30 },
    ];
    expect(limitToRecentMonths(unordered, 2)).toEqual([
      { year: 2025, month: 1, searches: 30 },
      { year: 2025, month: 2, searches: 40 },
    ]);
  });

  it('empty input → empty output', () => {
    expect(limitToRecentMonths([], 12)).toEqual([]);
  });
});
