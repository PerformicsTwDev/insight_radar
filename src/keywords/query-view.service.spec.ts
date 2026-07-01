import { BadRequestException } from '@nestjs/common';
import type { SnapshotRowData } from '../keyword-analysis/result-snapshot.checksum';
import type { FilterSpec } from './filter-spec';
import { QueryViewService } from './query-view.service';
import {
  BUILTIN_VIEWS,
  type ChartViewResult,
  type TableViewResult,
  ViewRegistry,
  type ViewDefinition,
} from './views';

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

/** allowedSelect/Filters/Sort 皆受限的 view，供白名單拒絕測試。 */
const restrictedView: ViewDefinition = {
  name: 'restricted',
  allowedSelect: ['text'],
  allowedFilters: ['q'],
  allowedSort: ['text'],
  build: () => ({
    view: 'restricted',
    columns: [],
    rows: [],
    pagination: { total: 0, page: 1, pageSize: 50, cursor: null },
  }),
};

const service = new QueryViewService(new ViewRegistry([...BUILTIN_VIEWS, restrictedView]));

/** 取 BadRequestException 的結構化 fields。 */
function fieldsOf(fn: () => unknown): Record<string, string[]> {
  try {
    fn();
  } catch (error) {
    const res = (error as BadRequestException).getResponse() as {
      fields: Record<string, string[]>;
    };
    return res.fields;
  }
  throw new Error('expected a BadRequestException');
}

describe('QueryViewService (T5.5 / FR-14 / TC-36)', () => {
  const rows = [
    srow({ normalizedText: 'a', avgMonthlySearches: 300 }),
    srow({ normalizedText: 'b', avgMonthlySearches: 100 }),
  ];

  it('routes a valid keywords query to the table view result', () => {
    const res = service.query(rows, { view: 'keywords' }, LIMITS) as TableViewResult;
    expect(res.view).toBe('keywords');
    expect(res.rows).toHaveLength(2);
    expect(res.columns.length).toBeGreaterThan(0);
  });

  it('routes a valid intent_distribution query to the chart view result', () => {
    const res = service.query(rows, { view: 'intent_distribution' }, LIMITS) as ChartViewResult;
    expect(res.view).toBe('intent_distribution');
    expect(res.groups.length).toBeGreaterThan(0);
  });

  it('throws 400 for an unknown view', () => {
    expect(() => service.query(rows, { view: 'nope' }, LIMITS)).toThrow(BadRequestException);
    expect(fieldsOf(() => service.query(rows, { view: 'nope' }, LIMITS))).toHaveProperty('view');
  });

  it('throws 400 for a select outside allowedSelect', () => {
    expect(
      fieldsOf(() => service.query(rows, { view: 'restricted', select: ['cpcLow'] }, LIMITS)),
    ).toHaveProperty('select');
  });

  it('throws 400 for a filter key outside allowedFilters', () => {
    expect(
      fieldsOf(() =>
        service.query(rows, { view: 'restricted', filters: { volumeMin: 5 } }, LIMITS),
      ),
    ).toHaveProperty('filters');
  });

  it('throws 400 for a sort field outside allowedSort', () => {
    expect(
      fieldsOf(() =>
        service.query(
          rows,
          { view: 'restricted', sort: [{ field: 'cpcLow', direction: 'asc' }] },
          LIMITS,
        ),
      ),
    ).toHaveProperty('sort');
  });

  it('throws 400 when pageSize exceeds the configured max', () => {
    expect(
      fieldsOf(() =>
        service.query(rows, { view: 'keywords', pagination: { pageSize: 500 } }, LIMITS),
      ),
    ).toHaveProperty('pageSize');
  });

  it('throws 400 for min > max on a range filter', () => {
    const filters: FilterSpec = { volumeMin: 200, volumeMax: 100 };
    expect(
      fieldsOf(() => service.query(rows, { view: 'keywords', filters }, LIMITS)),
    ).toHaveProperty('volumeMin');
  });

  it('maps an AggregateBoundsError from the engine to 400', () => {
    // maxBuckets 過小 + 多桶 → cpc_histogram 內部 aggregate 拋 AggregateBoundsError。
    const many = Array.from({ length: 10 }, (_, i) => srow({ normalizedText: `k${i}`, cpcLow: i }));
    expect(() =>
      service.query(many, { view: 'cpc_histogram' }, { ...LIMITS, aggMaxBuckets: 2 }),
    ).toThrow(BadRequestException);
    expect(
      fieldsOf(() =>
        service.query(many, { view: 'cpc_histogram' }, { ...LIMITS, aggMaxBuckets: 2 }),
      ),
    ).toHaveProperty('aggregate');
  });

  it('accepts a valid range (min <= max) and does not throw', () => {
    expect(() =>
      service.query(rows, { view: 'keywords', filters: { volumeMin: 50, volumeMax: 300 } }, LIMITS),
    ).not.toThrow();
  });

  it('re-throws a non-bounds error from view.build unchanged (does not mask a real bug as 400)', () => {
    const boom = new Error('view bug');
    const explodingView: ViewDefinition = {
      name: 'explode',
      allowedSelect: [],
      allowedFilters: [],
      allowedSort: [],
      build: () => {
        throw boom;
      },
    };
    const svc = new QueryViewService(new ViewRegistry([explodingView]));
    try {
      svc.query([], { view: 'explode' }, LIMITS);
      throw new Error('expected view.build error to propagate');
    } catch (error) {
      expect(error).toBe(boom); // 原錯誤原樣拋出
      expect(error).not.toBeInstanceOf(BadRequestException); // 非誤轉為 400
    }
  });
});
