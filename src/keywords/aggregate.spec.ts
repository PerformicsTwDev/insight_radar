import {
  AggregateBoundsError,
  aggregate,
  type AggregateLimits,
  type AggregateRow,
} from './aggregate';

const LIMITS: AggregateLimits = { maxBuckets: 200, maxGroups: 1000 };

function row(normalizedText: string, over: Partial<AggregateRow> = {}): AggregateRow {
  return {
    normalizedText,
    intent: ['informational'],
    competition: 'LOW',
    avgMonthlySearches: 100,
    competitionIndex: 10,
    cpcLow: 1,
    cpcHigh: 2,
    ...over,
  };
}

/** 取某 group（依 key 欄位值）的 measures。 */
function groupBy(
  res: { groups: { key: Record<string, string | number>; measures: Record<string, number> }[] },
  keyField: string,
  keyValue: string | number,
): Record<string, number> | undefined {
  return res.groups.find((g) => g.key[keyField] === keyValue)?.measures;
}

describe('aggregate — chart grouping/bucketing engine (T5.5 / FR-14 / TC-36)', () => {
  it('explodes an array dimension: count can exceed row count, countDistinct is unique rows', () => {
    const rows = [
      row('a', { intent: ['informational', 'commercial'] }),
      row('b', { intent: ['commercial'] }),
      row('c', { intent: [] }), // 無 label → 不計入任何 group
    ];
    const res = aggregate(
      rows,
      {
        dimensions: [{ as: 'intentLabel', field: 'intent', kind: 'explode' }],
        measures: [
          { as: 'count', fn: 'count' },
          { as: 'uniq', fn: 'countDistinct', field: 'normalizedText' },
        ],
      },
      LIMITS,
    );
    expect(groupBy(res, 'intentLabel', 'informational')).toMatchObject({ count: 1, uniq: 1 });
    expect(groupBy(res, 'intentLabel', 'commercial')).toMatchObject({ count: 2, uniq: 2 });
    // a 貢獻 2 units、b 貢獻 1 → 總 count 3 > 有 label 的列數 2（explosion 特性）。
    const totalCount = res.groups.reduce((s, g) => s + g.measures.count, 0);
    expect(totalCount).toBe(3);
  });

  it('buckets a numeric dimension left-closed right-open by width; null skipped', () => {
    const rows = [
      row('a', { cpcLow: 0 }),
      row('b', { cpcLow: 4.9 }),
      row('c', { cpcLow: 5 }),
      row('d', { cpcLow: 12 }),
      row('e', { cpcLow: null }),
    ];
    const res = aggregate(
      rows,
      {
        dimensions: [{ as: 'bucket', field: 'cpcLow', kind: 'bucket', width: 5 }],
        measures: [{ as: 'n', fn: 'count' }],
      },
      LIMITS,
    );
    expect(groupBy(res, 'bucket', 0)?.n).toBe(2); // [0,5): a, b
    expect(groupBy(res, 'bucket', 5)?.n).toBe(1); // [5,10): c
    expect(groupBy(res, 'bucket', 10)?.n).toBe(1); // [10,15): d
    expect(res.groups.some((g) => g.key.bucket === 15)).toBe(false); // e (null) 不落桶
  });

  it('computes sum/avg/min/max/median over a numeric field, skipping null', () => {
    const rows = [
      row('a', { avgMonthlySearches: 10 }),
      row('b', { avgMonthlySearches: 20 }),
      row('c', { avgMonthlySearches: null }), // 略過
      row('d', { avgMonthlySearches: 30 }),
    ];
    const res = aggregate(
      rows,
      {
        dimensions: [{ as: 'comp', field: 'competition', kind: 'value' }],
        measures: [
          { as: 'total', fn: 'sum', field: 'avgMonthlySearches' },
          { as: 'mean', fn: 'avg', field: 'avgMonthlySearches' },
          { as: 'lo', fn: 'min', field: 'avgMonthlySearches' },
          { as: 'hi', fn: 'max', field: 'avgMonthlySearches' },
          { as: 'mid', fn: 'median', field: 'avgMonthlySearches' },
          { as: 'n', fn: 'count' },
        ],
      },
      LIMITS,
    );
    expect(groupBy(res, 'comp', 'LOW')).toMatchObject({
      total: 60,
      mean: 20, // (10+20+30)/3，null 不計
      lo: 10,
      hi: 30,
      mid: 20, // median of [10,20,30]
      n: 4, // count 不受 null 影響
    });
  });

  it('takes the median of an even-length set as the mean of the two middle values', () => {
    const rows = [
      row('a', { competition: 'X', cpcLow: 1 }),
      row('b', { competition: 'X', cpcLow: 2 }),
      row('c', { competition: 'X', cpcLow: 3 }),
      row('d', { competition: 'X', cpcLow: 4 }),
    ];
    const res = aggregate(
      rows,
      {
        dimensions: [{ as: 'c', field: 'competition', kind: 'value' }],
        measures: [{ as: 'mid', fn: 'median', field: 'cpcLow' }],
      },
      LIMITS,
    );
    expect(groupBy(res, 'c', 'X')?.mid).toBe(2.5); // (2+3)/2
  });

  it('groups by a categorical value dimension', () => {
    const rows = [
      row('a', { competition: 'LOW' }),
      row('b', { competition: 'HIGH' }),
      row('c', { competition: 'LOW' }),
    ];
    const res = aggregate(
      rows,
      {
        dimensions: [{ as: 'comp', field: 'competition', kind: 'value' }],
        measures: [{ as: 'n', fn: 'count' }],
      },
      LIMITS,
    );
    expect(groupBy(res, 'comp', 'LOW')?.n).toBe(2);
    expect(groupBy(res, 'comp', 'HIGH')?.n).toBe(1);
  });

  it('supports two dimensions (composite grouping)', () => {
    const rows = [
      row('a', { competition: 'LOW', intent: ['informational'] }),
      row('b', { competition: 'LOW', intent: ['commercial'] }),
      row('c', { competition: 'LOW', intent: ['informational'] }),
    ];
    const res = aggregate(
      rows,
      {
        dimensions: [
          { as: 'comp', field: 'competition', kind: 'value' },
          { as: 'intentLabel', field: 'intent', kind: 'explode' },
        ],
        measures: [{ as: 'n', fn: 'count' }],
      },
      LIMITS,
    );
    const g = res.groups.find((x) => x.key.comp === 'LOW' && x.key.intentLabel === 'informational');
    expect(g?.measures.n).toBe(2);
  });

  it('sorts by a measure and applies limit, flagging meta.truncated when groups exceed the limit', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`k${i}`, { competition: `C${i}` }));
    const res = aggregate(
      rows,
      {
        dimensions: [{ as: 'c', field: 'competition', kind: 'value' }],
        measures: [{ as: 'n', fn: 'count' }],
        sort: { by: 'n', dir: 'desc' },
        limit: 3,
      },
      LIMITS,
    );
    expect(res.groups).toHaveLength(3);
    expect(res.meta.truncated).toBe(true);
    expect(res.meta.total).toBe(5); // 截斷前的總 group 數
  });

  it('caps groups at maxGroups and flags truncated when no explicit limit', () => {
    const rows = Array.from({ length: 6 }, (_, i) => row(`k${i}`, { competition: `C${i}` }));
    const res = aggregate(
      rows,
      {
        dimensions: [{ as: 'c', field: 'competition', kind: 'value' }],
        measures: [{ as: 'n', fn: 'count' }],
      },
      { maxBuckets: 200, maxGroups: 4 },
    );
    expect(res.groups).toHaveLength(4);
    expect(res.meta.truncated).toBe(true);
  });

  it('does not flag truncated when groups fit', () => {
    const rows = [row('a', { competition: 'LOW' }), row('b', { competition: 'HIGH' })];
    const res = aggregate(
      rows,
      {
        dimensions: [{ as: 'c', field: 'competition', kind: 'value' }],
        measures: [{ as: 'n', fn: 'count' }],
      },
      LIMITS,
    );
    expect(res.meta.truncated).toBe(false);
  });

  it('excludes a row from a value dimension when the field is null/undefined', () => {
    const rows = [
      row('a', { source: 'seed' }),
      row('b', { source: null }), // null → 不入組
      row('c', { source: 'seed' }),
    ];
    const res = aggregate(
      rows,
      {
        dimensions: [{ as: 'src', field: 'source', kind: 'value' }],
        measures: [{ as: 'n', fn: 'count' }],
      },
      LIMITS,
    );
    expect(res.groups).toHaveLength(1); // 只有 'seed' 一組
    expect(groupBy(res, 'src', 'seed')?.n).toBe(2);
  });

  it('returns 0 for a numeric measure when every value in the group is null', () => {
    const rows = [
      row('a', { competition: 'LOW', avgMonthlySearches: null }),
      row('b', { competition: 'LOW', avgMonthlySearches: null }),
    ];
    const res = aggregate(
      rows,
      {
        dimensions: [{ as: 'c', field: 'competition', kind: 'value' }],
        measures: [
          { as: 'total', fn: 'sum', field: 'avgMonthlySearches' },
          { as: 'mean', fn: 'avg', field: 'avgMonthlySearches' },
          { as: 'mid', fn: 'median', field: 'avgMonthlySearches' },
        ],
      },
      LIMITS,
    );
    expect(groupBy(res, 'c', 'LOW')).toMatchObject({ total: 0, mean: 0, mid: 0 });
  });

  it('countDistinct defaults to normalizedText when no field is given', () => {
    const rows = [
      row('a', { competition: 'LOW' }),
      row('a', { competition: 'LOW' }), // 同 nt → 去重後 1
      row('b', { competition: 'LOW' }),
    ];
    const res = aggregate(
      rows,
      {
        dimensions: [{ as: 'c', field: 'competition', kind: 'value' }],
        measures: [
          { as: 'rows', fn: 'count' },
          { as: 'uniq', fn: 'countDistinct' }, // 無 field → normalizedText
        ],
      },
      LIMITS,
    );
    expect(groupBy(res, 'c', 'LOW')).toMatchObject({ rows: 3, uniq: 2 });
  });

  it('sorts by a categorical dimension key (string ordering)', () => {
    const rows = [
      row('a', { competition: 'MEDIUM' }),
      row('b', { competition: 'LOW' }),
      row('c', { competition: 'HIGH' }),
    ];
    const res = aggregate(
      rows,
      {
        dimensions: [{ as: 'comp', field: 'competition', kind: 'value' }],
        measures: [{ as: 'n', fn: 'count' }],
        sort: { by: 'comp', dir: 'asc' },
      },
      LIMITS,
    );
    expect(res.groups.map((g) => g.key.comp)).toEqual(['HIGH', 'LOW', 'MEDIUM']);
  });

  it('treats a non-array explode field as contributing no groups', () => {
    const rows = [row('a', { intent: 'not-an-array' as unknown as string[] })];
    const res = aggregate(
      rows,
      {
        dimensions: [{ as: 'intentLabel', field: 'intent', kind: 'explode' }],
        measures: [{ as: 'n', fn: 'count' }],
      },
      LIMITS,
    );
    expect(res.groups).toHaveLength(0);
  });

  describe('bounds → AggregateBoundsError (→ 400)', () => {
    const dims = [{ as: 'c', field: 'competition', kind: 'value' as const }];
    const measures = [{ as: 'n', fn: 'count' as const }];

    it('rejects more than 2 dimensions', () => {
      expect(() =>
        aggregate(
          [row('a')],
          {
            dimensions: [
              { as: 'a', field: 'competition', kind: 'value' },
              { as: 'b', field: 'intent', kind: 'explode' },
              { as: 'c', field: 'cpcLow', kind: 'bucket', width: 1 },
            ],
            measures,
          },
          LIMITS,
        ),
      ).toThrow(AggregateBoundsError);
    });

    it('rejects zero dimensions', () => {
      expect(() => aggregate([row('a')], { dimensions: [], measures }, LIMITS)).toThrow(
        AggregateBoundsError,
      );
    });

    it('rejects a non-positive bucket width', () => {
      expect(() =>
        aggregate(
          [row('a')],
          { dimensions: [{ as: 'b', field: 'cpcLow', kind: 'bucket', width: 0 }], measures },
          LIMITS,
        ),
      ).toThrow(AggregateBoundsError);
    });

    it('rejects a value/median measure without a field', () => {
      expect(() =>
        aggregate([row('a')], { dimensions: dims, measures: [{ as: 's', fn: 'sum' }] }, LIMITS),
      ).toThrow(AggregateBoundsError);
    });

    it('rejects limit greater than maxGroups', () => {
      expect(() =>
        aggregate([row('a')], { dimensions: dims, measures, limit: 5000 }, LIMITS),
      ).toThrow(AggregateBoundsError);
    });

    it('rejects when a bucket dimension would produce more than maxBuckets buckets', () => {
      const rows = Array.from({ length: 10 }, (_, i) => row(`k${i}`, { cpcLow: i }));
      expect(() =>
        aggregate(
          rows,
          {
            dimensions: [{ as: 'b', field: 'cpcLow', kind: 'bucket', width: 1 }],
            measures,
          },
          { maxBuckets: 3, maxGroups: 1000 },
        ),
      ).toThrow(AggregateBoundsError);
    });
  });
});
