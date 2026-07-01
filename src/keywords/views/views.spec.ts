import type { SnapshotRowData } from '../../keyword-analysis/result-snapshot.checksum';
import {
  type ChartViewResult,
  type QueryRequest,
  type TableViewResult,
  type TrendViewResult,
  type ViewContext,
  ViewRegistry,
  cpcHistogramView,
  createViewRegistry,
  intentDistributionView,
  keywordsView,
  trendView,
} from './index';

const LIMITS = { maxPageSize: 200, aggMaxBuckets: 200, aggMaxGroups: 1000 };

function srow(over: Partial<SnapshotRowData> = {}): SnapshotRowData {
  return {
    text: 'kw',
    normalizedText: 'kw',
    avgMonthlySearches: 100,
    competition: 'LOW',
    competitionIndex: 10,
    cpcLow: 1,
    cpcHigh: 2,
    intent: ['informational'],
    monthlyVolumes: [],
    ...over,
  };
}

function ctx(rows: SnapshotRowData[], request: QueryRequest): ViewContext {
  return { rows, request, limits: LIMITS };
}

describe('ViewRegistry (T5.5 / FR-14 / NFR-10)', () => {
  const registry = createViewRegistry();

  it('registers the four built-in views and gets by name', () => {
    expect(registry.names().sort()).toEqual([
      'cpc_histogram',
      'intent_distribution',
      'keywords',
      'trend',
    ]);
    expect(registry.get('keywords')?.name).toBe('keywords');
    expect(registry.has('trend')).toBe(true);
  });

  it('returns undefined / false for an unknown view (→ 400 at the service)', () => {
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.has('nope')).toBe(false);
  });

  it('can be constructed directly with a custom view set (NFR-10: new view = one more definition)', () => {
    const custom = new ViewRegistry([keywordsView]);
    expect(custom.names()).toEqual(['keywords']);
    expect(custom.has('trend')).toBe(false);
  });
});

describe('keywords view (table)', () => {
  it('filters, sorts, paginates, and projects the selected columns', () => {
    const rows = [
      srow({ normalizedText: 'a', avgMonthlySearches: 300 }),
      srow({ normalizedText: 'b', avgMonthlySearches: 100 }),
      srow({ normalizedText: 'c', avgMonthlySearches: 200 }),
    ];
    const res = keywordsView.build(
      ctx(rows, {
        view: 'keywords',
        select: ['normalizedText', 'avgMonthlySearches'],
        sort: [{ field: 'avgMonthlySearches', direction: 'desc' }],
        pagination: { pageSize: 2 },
      }),
    ) as TableViewResult;

    expect(res.view).toBe('keywords');
    expect(res.columns.map((c) => c.key)).toEqual(['normalizedText', 'avgMonthlySearches']);
    expect(res.rows).toEqual([
      { normalizedText: 'a', avgMonthlySearches: 300 },
      { normalizedText: 'c', avgMonthlySearches: 200 }, // desc → a(300), c(200)
    ]);
    expect(res.pagination.total).toBe(3);
    expect(res.pagination.cursor).not.toBeNull(); // 還有下一頁
  });

  it('applies the shared FilterSpec', () => {
    const rows = [
      srow({ normalizedText: 'a', competition: 'LOW' }),
      srow({ normalizedText: 'b', competition: 'HIGH' }),
    ];
    const res = keywordsView.build(
      ctx(rows, { view: 'keywords', filters: { competition: ['LOW'] } }),
    ) as TableViewResult;
    expect(res.rows).toHaveLength(1);
  });

  it('defaults to all columns when select is omitted', () => {
    const res = keywordsView.build(ctx([srow()], { view: 'keywords' })) as TableViewResult;
    expect(res.columns.map((c) => c.key)).toContain('monthlyVolumes');
    expect(res.rows[0]).toHaveProperty('intent');
  });

  it('declares allowed select / filters / sort', () => {
    expect(keywordsView.allowedSelect).toContain('cpcLow');
    expect(keywordsView.allowedSort).toContain('avgMonthlySearches');
    expect(keywordsView.allowedFilters).toContain('q');
  });
});

describe('trend view', () => {
  it('builds the month axis + total + series from filtered rows', () => {
    const rows = [
      srow({ normalizedText: 'a', monthlyVolumes: [{ year: 2026, month: 1, searches: 100 }] }),
      srow({ normalizedText: 'b', monthlyVolumes: [{ year: 2026, month: 2, searches: 50 }] }),
    ];
    const res = trendView.build(ctx(rows, { view: 'trend' })) as TrendViewResult;
    expect(res.view).toBe('trend');
    expect(res.axis).toEqual(['2026-01', '2026-02']);
    expect(res.total).toEqual([100, 50]);
    expect(res.series).toHaveLength(2);
  });
});

describe('intent_distribution view', () => {
  it('explodes intent labels into groups with count + distinct keywords', () => {
    const rows = [
      srow({ normalizedText: 'a', intent: ['informational', 'commercial'] }),
      srow({ normalizedText: 'b', intent: ['commercial'] }),
    ];
    const res = intentDistributionView.build(
      ctx(rows, { view: 'intent_distribution' }),
    ) as ChartViewResult;
    expect(res.groups.find((g) => g.key.intentLabel === 'commercial')?.measures).toMatchObject({
      count: 2,
      keywords: 2,
    });
    expect(res.groups.find((g) => g.key.intentLabel === 'informational')?.measures.count).toBe(1);
  });
});

describe('cpc_histogram view', () => {
  it('buckets cpcLow into left-closed right-open bins; null skipped', () => {
    const rows = [
      srow({ normalizedText: 'a', cpcLow: 0.5 }),
      srow({ normalizedText: 'b', cpcLow: 1.5 }),
      srow({ normalizedText: 'c', cpcLow: 1.2 }),
      srow({ normalizedText: 'd', cpcLow: null }),
    ];
    const res = cpcHistogramView.build(ctx(rows, { view: 'cpc_histogram' })) as ChartViewResult;
    expect(res.groups.find((g) => g.key.bucket === 0)?.measures.count).toBe(1); // 0.5 → [0,1)
    expect(res.groups.find((g) => g.key.bucket === 1)?.measures.count).toBe(2); // 1.5,1.2 → [1,2)
    expect(res.groups.every((g) => typeof g.key.bucket === 'number')).toBe(true); // null 不落桶
  });
});
