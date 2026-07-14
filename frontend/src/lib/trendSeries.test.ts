import { describe, it, expect } from 'vitest';
import {
  alignToAxis,
  assembleTrendDatasets,
  buildTooltipRows,
  formatTooltipValue,
  monthKey,
  pickColor,
  type AggregateStyle,
  type AxisMonthlyVolume,
  type KeywordSeriesInput,
} from './trendSeries';

/**
 * TC-8 (FR-5, Design §6 C10) — per-keyword series align to the backend `axis` by
 * position; a month missing from a row (or present with `searches === null`)
 * becomes a `null` gap (never 0, C12); a month in the row but not on the axis is
 * dropped; the frontend never re-derives / reorders months.
 */
const v = (year: number, month: number, searches: number | null): AxisMonthlyVolume => ({
  year,
  month,
  searches,
});

const AGGREGATE: AggregateStyle = {
  label: '全部搜尋詞加總',
  color: '#52b788',
  fillColor: 'rgba(82, 183, 136, 0.15)',
};
const PALETTE = ['#aaa', '#bbb', '#ccc'] as const;

describe('TC-8 · monthKey (mirrors backend YYYY-MM key exactly — the alignment contract)', () => {
  it('zero-pads the month so lexical order equals chronological order', () => {
    expect(monthKey({ year: 2026, month: 1 })).toBe('2026-01');
    expect(monthKey({ year: 2026, month: 12 })).toBe('2026-12');
  });

  it('keeps the year verbatim across year boundaries', () => {
    expect(monthKey({ year: 2025, month: 12 })).toBe('2025-12');
    expect(monthKey({ year: 2026, month: 1 })).toBe('2026-01');
  });
});

describe('TC-8 · alignToAxis (C10 align-by-position; C12 null gaps)', () => {
  const axis = ['2026-01', '2026-02', '2026-03'];

  it('places each present month at its axis position', () => {
    const points = alignToAxis([v(2026, 1, 100), v(2026, 2, 120), v(2026, 3, 140)], axis);
    expect(points).toEqual([100, 120, 140]);
  });

  it('fills an axis month absent from the row with null (a gap, never 0)', () => {
    // row has only Jan + Mar → Feb is a null break, not 0.
    const points = alignToAxis([v(2026, 1, 100), v(2026, 3, 140)], axis);
    expect(points).toEqual([100, null, 140]);
  });

  it('keeps a month present with searches=null as a null gap (never 0 — C12)', () => {
    const points = alignToAxis([v(2026, 1, 100), v(2026, 2, null), v(2026, 3, 140)], axis);
    expect(points).toEqual([100, null, 140]);
  });

  it('preserves a real 0 (0 is a value, only null/missing → null)', () => {
    const points = alignToAxis([v(2026, 1, 0), v(2026, 2, 5)], ['2026-01', '2026-02']);
    expect(points).toEqual([0, 5]);
  });

  it('drops a month present in the row but not on the axis (axis is authoritative)', () => {
    // 2025-12 is not on the axis → it must not shift or leak into the aligned series.
    const points = alignToAxis([v(2025, 12, 999), v(2026, 1, 100), v(2026, 2, 120)], axis);
    expect(points).toEqual([100, 120, null]);
  });

  it('aligns by key regardless of row order (never re-derives months from array index)', () => {
    // volumes deliberately out of chronological order — alignment is by key, not position.
    const points = alignToAxis([v(2026, 3, 140), v(2026, 1, 100), v(2026, 2, 120)], axis);
    expect(points).toEqual([100, 120, 140]);
  });

  it('returns all-null for an empty row against a non-empty axis', () => {
    expect(alignToAxis([], axis)).toEqual([null, null, null]);
  });

  it('returns [] for an empty axis', () => {
    expect(alignToAxis([v(2026, 1, 100)], [])).toEqual([]);
  });
});

describe('TC-8 · pickColor (10-colour cycle by index)', () => {
  it('returns the palette entry at the index', () => {
    expect(pickColor(0, PALETTE)).toBe('#aaa');
    expect(pickColor(2, PALETTE)).toBe('#ccc');
  });

  it('wraps around modulo the palette length', () => {
    expect(pickColor(3, PALETTE)).toBe('#aaa');
    expect(pickColor(4, PALETTE)).toBe('#bbb');
  });
});

describe('TC-8 · assembleTrendDatasets (aggregate + axis-aligned per-keyword lines)', () => {
  const axis = ['2026-01', '2026-02', '2026-03'];
  const total = [300, 250, 400];

  it('builds an aggregate-only dataset when no keywords are selected', () => {
    const data = assembleTrendDatasets({ axis, total, palette: PALETTE, aggregate: AGGREGATE });
    expect(data.labels).toEqual(axis);
    expect(data.datasets).toHaveLength(1);
    const [agg] = data.datasets;
    expect(agg.label).toBe('全部搜尋詞加總');
    expect(agg.data).toEqual([300, 250, 400]);
    expect(agg.borderColor).toBe('#52b788');
    expect(agg.backgroundColor).toBe('rgba(82, 183, 136, 0.15)');
    expect(agg.fill).toBe(true);
  });

  it('adds one axis-aligned dataset per selected keyword (aggregate first, no fill)', () => {
    const keywords: KeywordSeriesInput[] = [
      { keyword: 'running shoes', volumes: [v(2026, 1, 100), v(2026, 3, 140)] },
      { keyword: 'trail shoes', volumes: [v(2026, 2, 50)] },
    ];
    const data = assembleTrendDatasets({ axis, total, keywords, palette: PALETTE, aggregate: AGGREGATE });
    expect(data.datasets).toHaveLength(3);
    // aggregate first
    expect(data.datasets[0].label).toBe('全部搜尋詞加總');
    // keyword lines share the SAME axis; missing months are null gaps (C10 + C12)
    expect(data.datasets[1]).toMatchObject({
      label: 'running shoes',
      data: [100, null, 140],
      borderColor: '#aaa',
      fill: false,
    });
    expect(data.datasets[2]).toMatchObject({
      label: 'trail shoes',
      data: [null, 50, null],
      borderColor: '#bbb',
      fill: false,
    });
  });

  it('cycles palette colours past its length for many keywords', () => {
    const keywords: KeywordSeriesInput[] = Array.from({ length: 4 }, (_, i) => ({
      keyword: `kw${i}`,
      volumes: [v(2026, 1, i)],
    }));
    const data = assembleTrendDatasets({ axis, total, keywords, palette: PALETTE, aggregate: AGGREGATE });
    // datasets[0] is aggregate; keyword i uses pickColor(i): #aaa,#bbb,#ccc,#aaa
    expect(data.datasets[1].borderColor).toBe('#aaa');
    expect(data.datasets[4].borderColor).toBe('#aaa'); // 4th keyword wraps back to index 0
  });

  it('handles an empty axis / total (empty state) with just an empty aggregate line', () => {
    const data = assembleTrendDatasets({ axis: [], total: [], palette: PALETTE, aggregate: AGGREGATE });
    expect(data.labels).toEqual([]);
    expect(data.datasets).toHaveLength(1);
    expect(data.datasets[0].data).toEqual([]);
  });
});

describe('TC-8 · tooltip formatting (null-safe, C12)', () => {
  it('formats a number and preserves 0', () => {
    expect(formatTooltipValue(1234)).toBe('1,234');
    expect(formatTooltipValue(0)).toBe('0');
  });

  it('renders — for null and undefined (never 0)', () => {
    expect(formatTooltipValue(null)).toBe('—');
    expect(formatTooltipValue(undefined)).toBe('—');
  });

  it('builds tooltip rows with null-safe values', () => {
    const rows = buildTooltipRows([
      { label: 'running shoes', value: 140, color: '#aaa' },
      { label: 'trail shoes', value: null, color: '#bbb' },
    ]);
    expect(rows).toEqual([
      { label: 'running shoes', value: '140', color: '#aaa' },
      { label: 'trail shoes', value: '—', color: '#bbb' },
    ]);
  });
});
