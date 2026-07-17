import type { SnapshotRowData } from '../../keyword-analysis/result-snapshot.checksum';
import { customView } from './custom.view';
import type { QueryRequest, TableViewResult, ViewContext } from './view-definition';

const LIMITS = { maxPageSize: 200, aggMaxBuckets: 200, aggMaxGroups: 1000 };
const CID = '11111111-1111-1111-1111-111111111111';

/** snapshot row + 由 load path left-join 帶入的 `label`。 */
function crow(over: Partial<SnapshotRowData>, label?: string): SnapshotRowData {
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
    ...(label !== undefined ? { label } : {}),
  };
}

function ctx(rows: SnapshotRowData[], request: QueryRequest): ViewContext {
  return { rows, request, limits: LIMITS };
}

describe('custom view (dynamic table, T12.9 / FR-34 / AC-34.3)', () => {
  it('names the view custom:{cid} and reuses the shared filters/sort/select', () => {
    const view = customView(CID);
    expect(view.name).toBe(`custom:${CID}`);
    expect(view.kind).toBe('table');
    expect(view.allowedSelect).toEqual(['text', 'normalizedText', 'label', 'avgMonthlySearches']);
    expect(view.allowedFilters).toContain('q');
    // per-cid gating lives in the load path — the view itself declares no feature requirement.
    expect(view.requiresFeature).toBeUndefined();
  });

  it('filters, paginates, and projects text + label', () => {
    const rows = [
      crow({ normalizedText: 'a', text: 'aa', avgMonthlySearches: 300 }, 'transactional'),
      crow({ normalizedText: 'b', text: 'bb', avgMonthlySearches: 100 }, 'informational'),
    ];
    const res = customView(CID).build(
      ctx(rows, { view: `custom:${CID}`, select: ['text', 'label'] }),
    ) as TableViewResult;
    expect(res.view).toBe(`custom:${CID}`);
    expect(res.columns.map((c) => c.key)).toEqual(['text', 'label']);
    expect(res.rows).toEqual([
      { text: 'aa', label: 'transactional' },
      { text: 'bb', label: 'informational' },
    ]);
    expect(res.pagination.total).toBe(2);
  });

  it('defaults to all columns (text/normalizedText/label/avgMonthlySearches) when select omitted', () => {
    const res = customView(CID).build(
      ctx([crow({ normalizedText: 'a' }, 'unclassified')], { view: `custom:${CID}` }),
    ) as TableViewResult;
    expect(res.columns.map((c) => c.key)).toEqual([
      'text',
      'normalizedText',
      'label',
      'avgMonthlySearches',
    ]);
    // the unclassified sentinel surfaces as its own bucket (visible/filterable), not hidden.
    expect(res.rows[0]).toMatchObject({ label: 'unclassified' });
  });

  it('applies the shared FilterSpec + sort', () => {
    const rows = [
      crow({ normalizedText: 'a', avgMonthlySearches: 100 }, 'informational'),
      crow({ normalizedText: 'b', avgMonthlySearches: 300 }, 'transactional'),
    ];
    const res = customView(CID).build(
      ctx(rows, {
        view: `custom:${CID}`,
        sort: [{ field: 'avgMonthlySearches', direction: 'desc' }],
      }),
    ) as TableViewResult;
    expect(res.rows.map((r) => r.label)).toEqual(['transactional', 'informational']);
  });

  it('leaves label undefined for an unassigned keyword (left-join miss)', () => {
    const res = customView(CID).build(
      ctx([crow({ normalizedText: 'a' })], { view: `custom:${CID}`, select: ['text', 'label'] }),
    ) as TableViewResult;
    expect(res.rows[0]).toEqual({ text: 'kw', label: undefined });
  });
});
