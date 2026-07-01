import type { MonthlySearchVolume } from '../google-ads/mapping/map-monthly-volumes';
import { buildTrend, type TrendRow } from './build-trend';

function mv(year: number, month: number, searches: number | null): MonthlySearchVolume {
  return { year, month, searches };
}

function trendRow(
  text: string,
  avgMonthlySearches: number | null,
  monthlyVolumes: MonthlySearchVolume[],
): TrendRow {
  return { text, normalizedText: text, avgMonthlySearches, monthlyVolumes };
}

const rows: TrendRow[] = [
  trendRow('a', 300, [mv(2026, 1, 100), mv(2026, 2, 200)]),
  trendRow('b', 200, [mv(2026, 2, 50), mv(2026, 3, 80)]),
  trendRow('c', 100, [mv(2026, 1, 10), mv(2026, 3, null)]), // 2026-03 有月份但 searches=null
];

describe('buildTrend (T5.3 / FR-5 / TC-6)', () => {
  it('unions (year,month) into a sorted YYYY-MM axis', () => {
    expect(buildTrend(rows).axis).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('orders the axis across year boundaries', () => {
    const r = [trendRow('x', 100, [mv(2025, 12, 5), mv(2026, 1, 7)])];
    expect(buildTrend(r).axis).toEqual(['2025-12', '2026-01']);
  });

  it('total series sums per month; null not counted; empty month within axis → 0', () => {
    // 2026-01: a100+c10=110 · 2026-02: a200+b50=250 · 2026-03: b80 + c(null 不計)=80
    expect(buildTrend(rows).total).toEqual([110, 250, 80]);
  });

  it('a null monthly_searches is excluded from the total (not summed as 0)', () => {
    const r = [
      trendRow('x', 100, [mv(2026, 1, null)]), // 只有 null
      trendRow('y', 50, [mv(2026, 1, 30)]),
    ];
    const t = buildTrend(r);
    expect(t.axis).toEqual(['2026-01']);
    expect(t.total).toEqual([30]); // x 的 null 不計入，只有 y=30
  });

  it('a month present only via null searches is in the axis with total 0', () => {
    const r = [trendRow('x', 100, [mv(2026, 1, null)])];
    const t = buildTrend(r);
    expect(t.axis).toEqual(['2026-01']);
    expect(t.total).toEqual([0]); // 該月全無資料 → 0
    expect(t.series[0].points).toEqual([null]); // null searches → null point
  });

  it('a 0 monthly_searches counts as 0 (a real value, not null)', () => {
    const r = [trendRow('x', 100, [mv(2026, 1, 0)])];
    const t = buildTrend(r);
    expect(t.total).toEqual([0]);
    expect(t.series[0].points).toEqual([0]); // 0 而非 null
  });

  it('top-N individual series align to axis; missing month and null searches → null (break)', () => {
    const t = buildTrend(rows, 3);
    const byKw = Object.fromEntries(t.series.map((s) => [s.keyword, s.points]));
    expect(byKw.a).toEqual([100, 200, null]); // 2026-03 缺月 → null
    expect(byKw.b).toEqual([null, 50, 80]); // 2026-01 缺月 → null
    expect(byKw.c).toEqual([10, null, null]); // 2026-02 缺月 → null；2026-03 null searches → null
  });

  it('takes top-N rows ranked by avgMonthlySearches desc', () => {
    expect(buildTrend(rows, 2).series.map((s) => s.keyword)).toEqual(['a', 'b']);
  });

  it('defaults topN to 10 when omitted', () => {
    expect(buildTrend(rows).series).toHaveLength(3); // 只有 3 列 → 全數
  });

  it('ranks null avgMonthlySearches last, tie-broken by normalizedText', () => {
    const r = [
      trendRow('z', null, [mv(2026, 1, 1)]),
      trendRow('a', null, [mv(2026, 1, 1)]),
      trendRow('m', 50, [mv(2026, 1, 1)]),
    ];
    // 50 先；兩個 null 以 nt asc（a<z）。
    expect(buildTrend(r, 3).series.map((s) => s.keyword)).toEqual(['m', 'a', 'z']);
  });

  it('breaks equal-avg ties by normalizedText for a deterministic top-N', () => {
    const r = [
      trendRow('c', 100, [mv(2026, 1, 1)]),
      trendRow('a', 100, [mv(2026, 1, 1)]),
      trendRow('b', 100, [mv(2026, 1, 1)]),
    ];
    expect(buildTrend(r, 2).series.map((s) => s.keyword)).toEqual(['a', 'b']);
  });

  it('topN of 0 yields no series (axis/total still computed over all rows)', () => {
    const t = buildTrend(rows, 0);
    expect(t.series).toEqual([]);
    expect(t.axis).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(t.total).toEqual([110, 250, 80]);
  });

  it('empty input yields empty axis/total/series', () => {
    expect(buildTrend([])).toEqual({ axis: [], total: [], series: [] });
  });

  it('does not mutate the input rows', () => {
    const r = [trendRow('a', 1, [mv(2026, 1, 1)]), trendRow('b', 2, [mv(2026, 1, 1)])];
    const before = r.map((x) => x.normalizedText);
    buildTrend(r);
    expect(r.map((x) => x.normalizedText)).toEqual(before);
  });
});
