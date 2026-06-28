import { enums } from 'google-ads-api';
import { mapMonthlyVolumes } from './map-monthly-volumes';
import type { RawMonthlySearchVolume } from './map-monthly-volumes';

describe('mapMonthlyVolumes (TC-5)', () => {
  it('maps MonthOfYear by NAME: JANUARY -> 1 (NOT the proto integer 2)', () => {
    const raw: RawMonthlySearchVolume[] = [{ year: 2025, month: 'JANUARY', monthly_searches: 100 }];
    expect(mapMonthlyVolumes(raw)).toEqual([{ year: 2025, month: 1, searches: 100 }]);
  });

  it('maps DECEMBER -> 12', () => {
    const raw: RawMonthlySearchVolume[] = [{ year: 2025, month: 'DECEMBER', monthly_searches: 5 }];
    expect(mapMonthlyVolumes(raw)).toEqual([{ year: 2025, month: 12, searches: 5 }]);
  });

  it('resolves the proto integer value via the package enum names (no off-by-one)', () => {
    // 上游可能回 proto 整數（JANUARY=2）；必須先反查名稱再映射，故 proto-2 -> month 1。
    const raw: RawMonthlySearchVolume[] = [
      { year: 2025, month: enums.MonthOfYear.JANUARY, monthly_searches: 7 }, // proto int = 2
      { year: 2025, month: enums.MonthOfYear.DECEMBER, monthly_searches: 9 }, // proto int = 13
    ];
    expect(mapMonthlyVolumes(raw)).toEqual([
      { year: 2025, month: 1, searches: 7 },
      { year: 2025, month: 12, searches: 9 },
    ]);
  });

  it('keeps null monthly_searches as null (not 0)', () => {
    const raw: RawMonthlySearchVolume[] = [{ year: 2025, month: 'MARCH', monthly_searches: null }];
    expect(mapMonthlyVolumes(raw)).toEqual([{ year: 2025, month: 3, searches: null }]);
  });

  it('treats a missing monthly_searches field as null', () => {
    const raw: RawMonthlySearchVolume[] = [{ year: 2025, month: 'APRIL' }];
    expect(mapMonthlyVolumes(raw)).toEqual([{ year: 2025, month: 4, searches: null }]);
  });

  it('maps all twelve months to 1..12 in order by name', () => {
    const names = [
      'JANUARY',
      'FEBRUARY',
      'MARCH',
      'APRIL',
      'MAY',
      'JUNE',
      'JULY',
      'AUGUST',
      'SEPTEMBER',
      'OCTOBER',
      'NOVEMBER',
      'DECEMBER',
    ] as const;
    const raw: RawMonthlySearchVolume[] = names.map((month, i) => ({
      year: 2025,
      month,
      monthly_searches: i,
    }));
    expect(mapMonthlyVolumes(raw).map((v) => v.month)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it('skips entries with an unspecified/unknown/unrecognised month', () => {
    const raw: RawMonthlySearchVolume[] = [
      { year: 2025, month: 'UNSPECIFIED', monthly_searches: 1 },
      { year: 2025, month: 'UNKNOWN', monthly_searches: 2 },
      { year: 2025, month: 'JUNE', monthly_searches: 3 },
    ];
    expect(mapMonthlyVolumes(raw)).toEqual([{ year: 2025, month: 6, searches: 3 }]);
  });

  it('skips proto-integer UNSPECIFIED (0) and UNKNOWN (1) months', () => {
    const raw: RawMonthlySearchVolume[] = [
      { year: 2025, month: enums.MonthOfYear.UNSPECIFIED, monthly_searches: 1 }, // proto 0
      { year: 2025, month: enums.MonthOfYear.UNKNOWN, monthly_searches: 2 }, // proto 1
      { year: 2025, month: enums.MonthOfYear.MAY, monthly_searches: 3 }, // proto 6 -> month 5
    ];
    expect(mapMonthlyVolumes(raw)).toEqual([{ year: 2025, month: 5, searches: 3 }]);
  });

  it('maps a non-numeric monthly_searches to null (never NaN)', () => {
    const raw: RawMonthlySearchVolume[] = [{ year: 2025, month: 'JUNE', monthly_searches: 'abc' }];
    expect(mapMonthlyVolumes(raw)).toEqual([{ year: 2025, month: 6, searches: null }]);
  });

  it('maps an empty / whitespace monthly_searches to null, NOT 0 (M1-R2, null≠0)', () => {
    expect(mapMonthlyVolumes([{ year: 2025, month: 'JUNE', monthly_searches: '' }])).toEqual([
      { year: 2025, month: 6, searches: null },
    ]);
    expect(mapMonthlyVolumes([{ year: 2025, month: 'JUNE', monthly_searches: '   ' }])).toEqual([
      { year: 2025, month: 6, searches: null },
    ]);
  });

  it('skips an entry with a non-finite year (M1-R2; never emits year NaN/0)', () => {
    const raw: RawMonthlySearchVolume[] = [
      { year: 'abc', month: 'JUNE', monthly_searches: 5 },
      { year: '', month: 'JULY', monthly_searches: 5 },
      { year: '2025', month: 'AUGUST', monthly_searches: 5 },
    ];
    expect(mapMonthlyVolumes(raw)).toEqual([{ year: 2025, month: 8, searches: 5 }]);
  });

  it('returns an empty array for empty / undefined input', () => {
    expect(mapMonthlyVolumes([])).toEqual([]);
    expect(mapMonthlyVolumes(undefined)).toEqual([]);
  });
});
