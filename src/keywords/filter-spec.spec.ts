import {
  applyFilter,
  buildPredicate,
  type FilterableKeyword,
  type FilterSpec,
} from './filter-spec';

/** 可篩選列（snapshot row 的子集；`SnapshotRowData` 結構上滿足此型）。 */
function row(overrides: Partial<FilterableKeyword> = {}): FilterableKeyword {
  return {
    text: 'running shoes',
    avgMonthlySearches: 100,
    competition: 'LOW',
    competitionIndex: 10,
    cpcLow: 1,
    cpcHigh: 5,
    intent: ['informational'],
    ...overrides,
  };
}

describe('buildPredicate / FilterSpec (T5.1 / FR-7 / FR-14 / TC-9)', () => {
  it('volume range is inclusive of both bounds (缺值≠0：null 不滿足 range)', () => {
    const p = buildPredicate({ volumeMin: 100, volumeMax: 200 });
    expect(p(row({ avgMonthlySearches: 100 }))).toBe(true); // 下界含
    expect(p(row({ avgMonthlySearches: 200 }))).toBe(true); // 上界含
    expect(p(row({ avgMonthlySearches: 99 }))).toBe(false);
    expect(p(row({ avgMonthlySearches: 201 }))).toBe(false);
    expect(p(row({ avgMonthlySearches: null }))).toBe(false); // 缺值不滿足區間
  });

  it('volume with only one bound set', () => {
    expect(buildPredicate({ volumeMin: 50 })(row({ avgMonthlySearches: 50 }))).toBe(true);
    expect(buildPredicate({ volumeMin: 50 })(row({ avgMonthlySearches: 49 }))).toBe(false);
    expect(buildPredicate({ volumeMax: 50 })(row({ avgMonthlySearches: 50 }))).toBe(true);
    expect(buildPredicate({ volumeMax: 50 })(row({ avgMonthlySearches: 51 }))).toBe(false);
  });

  it('q is a case-insensitive substring match on text', () => {
    const p = buildPredicate({ q: 'SHOE' });
    expect(p(row({ text: 'Running Shoes' }))).toBe(true);
    expect(p(row({ text: 'SNEAKERS' }))).toBe(false);
  });

  it('intent any = some selected in labels; all = every selected in labels', () => {
    const r = row({ intent: ['informational', 'commercial'] });
    expect(buildPredicate({ intent: ['commercial', 'transactional'], intentMode: 'any' })(r)).toBe(
      true,
    ); // commercial 命中
    expect(buildPredicate({ intent: ['commercial', 'transactional'], intentMode: 'all' })(r)).toBe(
      false,
    ); // transactional 缺
    expect(buildPredicate({ intent: ['informational', 'commercial'], intentMode: 'all' })(r)).toBe(
      true,
    ); // 全含
  });

  it('intentMode defaults to any', () => {
    const r = row({ intent: ['commercial'] });
    expect(buildPredicate({ intent: ['commercial', 'transactional'] })(r)).toBe(true);
  });

  it('competition multi-select matches the enum set', () => {
    const p = buildPredicate({ competition: ['LOW', 'HIGH'] });
    expect(p(row({ competition: 'LOW' }))).toBe(true);
    expect(p(row({ competition: 'HIGH' }))).toBe(true);
    expect(p(row({ competition: 'MEDIUM' }))).toBe(false);
  });

  it('competitionIndex range is inclusive; null excluded when range set', () => {
    const p = buildPredicate({ competitionIndexMin: 10, competitionIndexMax: 50 });
    expect(p(row({ competitionIndex: 10 }))).toBe(true);
    expect(p(row({ competitionIndex: 50 }))).toBe(true);
    expect(p(row({ competitionIndex: 9 }))).toBe(false);
    expect(p(row({ competitionIndex: null }))).toBe(false);
  });

  it('cpc filter uses interval overlap: cpcHigh>=min AND cpcLow<=max (null cpc excluded)', () => {
    // row：cpcLow=1, cpcHigh=5
    expect(buildPredicate({ cpcMin: 4, cpcMax: 10 })(row())).toBe(true); // 5>=4 && 1<=10
    expect(buildPredicate({ cpcMin: 5 })(row())).toBe(true); // 邊界：5>=5
    expect(buildPredicate({ cpcMin: 6 })(row())).toBe(false); // 5>=6 false
    expect(buildPredicate({ cpcMax: 1 })(row())).toBe(true); // 邊界：1<=1
    expect(buildPredicate({ cpcMax: 0.5 })(row())).toBe(false); // 1<=0.5 false
    expect(buildPredicate({ cpcMin: 1 })(row({ cpcHigh: null }))).toBe(false); // null cpcHigh 不滿足 min
    expect(buildPredicate({ cpcMax: 10 })(row({ cpcLow: null }))).toBe(false); // null cpcLow 不滿足 max
  });

  it('combines all active filters with AND', () => {
    const p = buildPredicate({
      volumeMin: 50,
      q: 'shoe',
      intent: ['informational'],
      competition: ['LOW'],
      cpcMin: 2,
    });
    expect(p(row())).toBe(true); // 全中
    expect(p(row({ competition: 'HIGH' }))).toBe(false); // 一項不中 → 整體 false
    expect(p(row({ avgMonthlySearches: 10 }))).toBe(false);
    expect(p(row({ text: 'sneakers' }))).toBe(false);
  });

  it('an empty filter matches every row (含全 null 指標列)', () => {
    const p = buildPredicate({});
    expect(p(row())).toBe(true);
    expect(p(row({ avgMonthlySearches: null, cpcLow: null, cpcHigh: null, intent: [] }))).toBe(
      true,
    );
  });

  it('an empty intent[] / competition[] imposes no constraint', () => {
    expect(buildPredicate({ intent: [] })(row({ intent: [] }))).toBe(true);
    expect(buildPredicate({ competition: [] })(row({ competition: 'MEDIUM' }))).toBe(true);
  });

  it('honors 0-valued bounds (no falsy-zero footgun: 0 is an active bound, not unset)', () => {
    // volumeMin:0 為有效下界——0 搜量滿足，null 不滿足（缺值≠0）。
    expect(buildPredicate({ volumeMin: 0 })(row({ avgMonthlySearches: 0 }))).toBe(true);
    expect(buildPredicate({ volumeMin: 0 })(row({ avgMonthlySearches: null }))).toBe(false);
    // cpcMax:0 為有效上界——cpcLow=1 不滿足 1<=0；cpcMin:0 為有效下界——cpcHigh=5 滿足 5>=0。
    expect(buildPredicate({ cpcMax: 0 })(row())).toBe(false);
    expect(buildPredicate({ cpcMin: 0 })(row())).toBe(true);
    // competitionIndexMin:0 為有效下界——null 不滿足。
    expect(buildPredicate({ competitionIndexMin: 0 })(row({ competitionIndex: null }))).toBe(false);
    expect(buildPredicate({ competitionIndexMin: 0 })(row({ competitionIndex: 0 }))).toBe(true);
  });

  it('an empty q string keeps the contains check active and matches consistently', () => {
    // q='' → includes('') 為真：一致地匹配每列（不視為「未設」而拋出例外或反轉）。
    expect(buildPredicate({ q: '' })(row())).toBe(true);
    expect(buildPredicate({ q: '' })(row({ text: 'anything' }))).toBe(true);
  });
});

describe('applyFilter — single shared predicate, no view drift (TC-37 / AC-14.1 / AC-7.8)', () => {
  const rows = [
    row({ text: 'a', avgMonthlySearches: 100, intent: ['commercial'] }),
    row({ text: 'b', avgMonthlySearches: 10, intent: ['informational'] }),
    row({ text: 'c', avgMonthlySearches: 500, intent: ['commercial'] }),
  ];

  it('the keywords path and a view path applying the same FilterSpec get the identical subset', () => {
    const spec: FilterSpec = { volumeMin: 50, intent: ['commercial'] };
    // 兩個消費端（/keywords 與某 view）都經同一 buildPredicate：applyFilter 必須委派給 buildPredicate
    // （而非自帶分歧邏輯），否則此處會 drift。
    const keywordsSubset = applyFilter(rows, spec);
    const viewSubset = rows.filter(buildPredicate(spec));
    expect(keywordsSubset.map((r) => r.text)).toEqual(['a', 'c']);
    expect(viewSubset).toEqual(keywordsSubset);
  });

  it('applyFilter preserves input order of the filtered subset', () => {
    const spec: FilterSpec = { intent: ['commercial'] };
    expect(applyFilter(rows, spec).map((r) => r.text)).toEqual(['a', 'c']);
  });
});
