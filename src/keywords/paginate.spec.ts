import { selectPage, sortRows, type SortableRow } from './paginate';

function r(normalizedText: string, over: Partial<SortableRow> = {}): SortableRow {
  return {
    normalizedText,
    text: normalizedText,
    avgMonthlySearches: 100,
    competitionIndex: 10,
    cpcLow: 1,
    cpcHigh: 2,
    ...over,
  };
}

describe('sortRows (T5.2 / FR-6)', () => {
  it('defaults to avgMonthlySearches desc with normalizedText asc tie-break', () => {
    const rows = [
      r('a', { avgMonthlySearches: 300 }),
      r('b', { avgMonthlySearches: 100 }),
      r('c', { avgMonthlySearches: 200 }),
      r('d', { avgMonthlySearches: 100 }), // tie with b → nt asc: b before d
    ];
    expect(sortRows(rows).map((x) => x.normalizedText)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('honors sortDir asc', () => {
    const rows = [
      r('a', { avgMonthlySearches: 300 }),
      r('b', { avgMonthlySearches: 100 }),
      r('c', { avgMonthlySearches: 200 }),
    ];
    expect(sortRows(rows, 'avgMonthlySearches', 'asc').map((x) => x.normalizedText)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('honors sortBy on another numeric field', () => {
    const rows = [r('a', { cpcLow: 3 }), r('b', { cpcLow: 1 }), r('c', { cpcLow: 2 })];
    expect(sortRows(rows, 'cpcLow', 'asc').map((x) => x.normalizedText)).toEqual(['b', 'c', 'a']);
  });

  it('sorts text lexicographically', () => {
    const rows = [r('charlie'), r('alpha'), r('bravo')];
    expect(sortRows(rows, 'text', 'asc').map((x) => x.normalizedText)).toEqual([
      'alpha',
      'bravo',
      'charlie',
    ]);
  });

  it('puts null sort values last regardless of direction', () => {
    const rows = [
      r('a', { avgMonthlySearches: 100 }),
      r('b', { avgMonthlySearches: null }),
      r('c', { avgMonthlySearches: 200 }),
    ];
    expect(sortRows(rows, 'avgMonthlySearches', 'desc').map((x) => x.normalizedText)).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(sortRows(rows, 'avgMonthlySearches', 'asc').map((x) => x.normalizedText)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('does not mutate the input array', () => {
    const rows = [r('a', { avgMonthlySearches: 1 }), r('b', { avgMonthlySearches: 2 })];
    const before = rows.map((x) => x.normalizedText);
    sortRows(rows);
    expect(rows.map((x) => x.normalizedText)).toEqual(before);
  });

  it('produces a deterministic total order even when the sort key fully ties', () => {
    const rows = [r('c'), r('a'), r('b')]; // all avgMonthlySearches 100
    expect(sortRows(rows).map((x) => x.normalizedText)).toEqual(['a', 'b', 'c']); // nt asc tie-break
  });

  it('breaks ties by normalizedText for equal text and among null-valued rows', () => {
    // 同 text（sortBy=text）→ nt asc tie-break。
    const sameText = [r('b', { text: 'dup' }), r('a', { text: 'dup' })];
    expect(sortRows(sameText, 'text', 'asc').map((x) => x.normalizedText)).toEqual(['a', 'b']);
    // 兩列皆 null 搜量 → 一同置尾、彼此以 nt asc。
    const withNulls = [
      r('y', { avgMonthlySearches: null }),
      r('x', { avgMonthlySearches: null }),
      r('m', { avgMonthlySearches: 5 }),
    ];
    expect(sortRows(withNulls, 'avgMonthlySearches', 'desc').map((x) => x.normalizedText)).toEqual([
      'm',
      'x',
      'y',
    ]);
  });
});

describe('selectPage — offset + keyset, stable, no drift (T5.2 / FR-6)', () => {
  const rows = Array.from({ length: 25 }, (_, i) =>
    r(`kw-${String(i).padStart(2, '0')}`, { avgMonthlySearches: 1000 - i }),
  );

  it('offset page/pageSize returns the right slice and meta', () => {
    const p1 = selectPage(rows, {}, { page: 1, pageSize: 10 });
    expect(p1.rows).toHaveLength(10);
    expect(p1.rows[0].normalizedText).toBe('kw-00'); // highest volume first (desc)
    expect(p1.meta).toMatchObject({ total: 25, page: 1, pageSize: 10 });
    expect(p1.meta.cursor).not.toBeNull(); // more pages remain

    const p3 = selectPage(rows, {}, { page: 3, pageSize: 10 });
    expect(p3.rows).toHaveLength(5); // last partial page
    expect(p3.meta).toMatchObject({ total: 25, page: 3, pageSize: 10 });
    expect(p3.meta.cursor).toBeNull(); // last page → no next cursor
  });

  it('cursor keyset resumes exactly after the previous page (no overlap/skip)', () => {
    const p1 = selectPage(rows, {}, { pageSize: 10 });
    const p2 = selectPage(rows, {}, { pageSize: 10, cursor: p1.meta.cursor ?? undefined });
    expect(p1.rows.map((x) => x.normalizedText)).toEqual(
      rows.slice(0, 10).map((x) => x.normalizedText),
    );
    expect(p2.rows[0].normalizedText).toBe('kw-10'); // resumes right after kw-09
    // no overlap
    const overlap = p1.rows.filter((a) =>
      p2.rows.some((b) => b.normalizedText === a.normalizedText),
    );
    expect(overlap).toHaveLength(0);
  });

  it('paging through all rows via cursor yields every row exactly once, in order', () => {
    const collected: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 100; guard += 1) {
      const pageResult = selectPage(rows, {}, { pageSize: 7, cursor });
      collected.push(...pageResult.rows.map((x) => x.normalizedText));
      if (pageResult.meta.cursor === null) {
        break;
      }
      cursor = pageResult.meta.cursor;
    }
    const expected = sortRows(rows).map((x) => x.normalizedText);
    expect(collected).toEqual(expected); // 全部、各一次、依排序
    expect(new Set(collected).size).toBe(25);
  });

  it('repeated query of the same snapshot + params is identical (no drift)', () => {
    const a = selectPage(
      rows,
      { sortBy: 'avgMonthlySearches', sortDir: 'desc' },
      { page: 2, pageSize: 10 },
    );
    const b = selectPage(
      rows,
      { sortBy: 'avgMonthlySearches', sortDir: 'desc' },
      { page: 2, pageSize: 10 },
    );
    expect(a.rows.map((x) => x.normalizedText)).toEqual(b.rows.map((x) => x.normalizedText));
    expect(a.meta).toEqual(b.meta);
  });

  it('defaults pageSize when omitted and reports total', () => {
    const res = selectPage(rows, {}, {});
    expect(res.meta.total).toBe(25);
    expect(res.meta.pageSize).toBeGreaterThan(0);
    expect(res.meta.page).toBe(1);
  });

  it('an unknown cursor yields an empty final page (end of data)', () => {
    const res = selectPage(rows, {}, { pageSize: 10, cursor: encodeForTest('does-not-exist') });
    expect(res.rows).toHaveLength(0);
    expect(res.meta.cursor).toBeNull();
  });

  it('a malformed cursor is treated as unknown (empty page, does not throw 500)', () => {
    // 非 base64url / 非合法 JSON 的畸形 cursor（opaque）不得讓 hot path 拋錯。
    for (const bad of [
      '!!!not-base64!!!',
      'zzzz',
      Buffer.from('nope', 'utf8').toString('base64url'),
    ]) {
      const res = selectPage(rows, {}, { pageSize: 10, cursor: bad });
      expect(res.rows).toHaveLength(0);
      expect(res.meta.cursor).toBeNull();
    }
  });

  it('a page beyond the data returns empty rows with correct total', () => {
    const res = selectPage(rows, {}, { page: 99, pageSize: 10 });
    expect(res.rows).toHaveLength(0);
    expect(res.meta.total).toBe(25);
  });

  it('is defensive against non-positive pageSize/page (no NaN / negative-slice garbage)', () => {
    const zero = selectPage(rows, {}, { pageSize: 0 });
    expect(Number.isFinite(zero.meta.page)).toBe(true); // 非 NaN
    expect(zero.meta.pageSize).toBeGreaterThanOrEqual(1);
    const neg = selectPage(rows, {}, { pageSize: -10 });
    expect(neg.rows.length).toBeLessThanOrEqual(rows.length); // 非負 slice 的錯誤子集
    const page0 = selectPage(rows, {}, { page: 0, pageSize: 10 });
    expect(page0.meta.page).toBe(1); // page<1 夾為第 1 頁，meta 反映實際頁
    expect(page0.rows[0].normalizedText).toBe('kw-00');
  });

  it('is order-independent: a shuffled input yields the identical sorted page (no drift on reload)', () => {
    const shuffled = [...rows].reverse(); // 不同載入順序（模擬 snapshot 以不同順序重載）
    const fromOriginal = selectPage(rows, {}, { page: 2, pageSize: 10 });
    const fromShuffled = selectPage(shuffled, {}, { page: 2, pageSize: 10 });
    expect(fromShuffled.rows.map((x) => x.normalizedText)).toEqual(
      fromOriginal.rows.map((x) => x.normalizedText),
    );
  });
});

/** 與實作相同的 cursor 編碼（測試未知 cursor 用）。 */
function encodeForTest(nt: string): string {
  return Buffer.from(JSON.stringify({ nt }), 'utf8').toString('base64url');
}
