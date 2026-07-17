import type { SnapshotRowData } from '../../keyword-analysis/result-snapshot.checksum';
import {
  type ChartViewResult,
  type QueryRequest,
  type TableViewResult,
  type TrendViewResult,
  type ViewContext,
  type ViewDefinition,
  ViewRegistry,
  cpcHistogramView,
  createViewRegistry,
  intentDistributionView,
  intentTopicsView,
  journeyFunnelView,
  journeyView,
  keywordsView,
  serpQuestionsView,
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

  it('registers the built-in views (incl. gated serp_questions/intent_topics) and gets by name', () => {
    expect(registry.names().sort()).toEqual([
      'cpc_histogram',
      'intent_distribution',
      'intent_topics',
      'journey',
      'journey_funnel',
      'keywords',
      'serp_questions',
      'trend',
    ]);
    expect(registry.get('keywords')?.name).toBe('keywords');
    expect(registry.has('trend')).toBe(true);
    // T6.8：未來 view 已註冊，宣告依賴 feature（gating 由 QueryViewService 依 features 判定）。
    expect(registry.get('serp_questions')?.requiresFeature).toBe('serp');
    expect(registry.get('intent_topics')?.requiresFeature).toBe('topics');
    // T12.6：journey / journey_funnel 依賴 journey feature（未接 compute 前由 gate 擋）。
    expect(registry.get('journey')?.requiresFeature).toBe('journey');
    expect(registry.get('journey_funnel')?.requiresFeature).toBe('journey');
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

  it('throws on duplicate view names (fail-fast config error)', () => {
    expect(() => new ViewRegistry([keywordsView, keywordsView])).toThrow(/duplicate view name/);
  });

  it('metadata() 導出 AC-22.2 形狀；select 欄位缺型別來源 → 退回 text（M9-R5）', () => {
    // typed：'a' 有 selectColumn（number），'b' 無 → 退回 text（覆蓋 `?.type ?? 'text'`）。
    const typed: ViewDefinition = {
      name: 'typed',
      kind: 'table',
      grain: 'thing',
      allowedSelect: ['a', 'b'],
      selectColumns: [{ key: 'a', label: 'A', type: 'number' }],
      allowedFilters: ['a'],
      allowedSort: ['a'],
      build: () => ({
        view: 'typed',
        columns: [],
        rows: [],
        pagination: { total: 0, page: 1, pageSize: 20, cursor: null },
      }),
    };
    // untyped：非空 allowedSelect 但**無** selectColumns → 退回 text（覆蓋 `selectColumns?.` undefined 路徑）。
    const untyped: ViewDefinition = {
      name: 'untyped',
      kind: 'chart',
      grain: 'g2',
      allowedSelect: ['x'],
      allowedFilters: [],
      allowedSort: [],
      build: () => ({ view: 'untyped', groups: [], meta: { total: 0, truncated: false } }),
    };

    const meta = new ViewRegistry([typed, untyped]).metadata();
    const t = meta.find((m) => m.name === 'typed');
    expect(t).toMatchObject({ name: 'typed', grain: 'thing', responseShape: 'table' });
    expect(t?.allowedSelect).toEqual([
      { key: 'a', type: 'number' },
      { key: 'b', type: 'text' }, // 缺 selectColumn → fallback
    ]);
    expect(t?.requiresFeature).toBe('keyword_metrics'); // 未指定 → 預設 feature
    const u = meta.find((m) => m.name === 'untyped');
    expect(u?.allowedSelect).toEqual([{ key: 'x', type: 'text' }]); // 無 selectColumns → fallback
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

describe('placeholder views (serp_questions / intent_topics, T6.8)', () => {
  it('declare their required feature and build an empty table shell (gated until compute lands)', () => {
    expect(serpQuestionsView.requiresFeature).toBe('serp');
    expect(intentTopicsView.requiresFeature).toBe('topics');

    // build 僅在 feature ready 後才由 QueryViewService 呼叫；compute 未落地 → 空表形狀（欄位正確、rows 空）。
    const res = serpQuestionsView.build(
      ctx([srow()], { view: 'serp_questions' }),
    ) as TableViewResult;
    expect(res.view).toBe('serp_questions');
    expect(res.rows).toEqual([]);
    expect(res.pagination.total).toBe(0);
    expect(res.columns.map((c) => c.key)).toContain('questionText');

    const topics = intentTopicsView.build(
      ctx([srow()], { view: 'intent_topics' }),
    ) as TableViewResult;
    expect(topics.view).toBe('intent_topics');
    expect(topics.rows).toEqual([]);
  });
});

/** journey rows：srow + left-joined `stage`（stage 非 SnapshotRowData 欄，測試以 cast 附掛）。 */
function jrow(over: Partial<SnapshotRowData>, stage?: string): SnapshotRowData {
  return { ...srow(over), ...(stage !== undefined ? { stage } : {}) };
}

describe('journey view (table, T12.6 / FR-33 / AC-33.4)', () => {
  it('filters, paginates, and projects text + stage', () => {
    const rows = [
      jrow({ normalizedText: 'a', text: 'aa', avgMonthlySearches: 300 }, 'final_decision'),
      jrow({ normalizedText: 'b', text: 'bb', avgMonthlySearches: 100 }, 'need_definition'),
    ];
    const res = journeyView.build(
      ctx(rows, { view: 'journey', select: ['text', 'stage'] }),
    ) as TableViewResult;
    expect(res.view).toBe('journey');
    expect(res.columns.map((c) => c.key)).toEqual(['text', 'stage']);
    expect(res.rows).toEqual([
      { text: 'aa', stage: 'final_decision' },
      { text: 'bb', stage: 'need_definition' },
    ]);
    expect(res.pagination.total).toBe(2);
  });

  it('defaults to all columns (text/normalizedText/stage/avgMonthlySearches) when select omitted', () => {
    const res = journeyView.build(
      ctx([jrow({ normalizedText: 'a' }, 'spec_comparison')], { view: 'journey' }),
    ) as TableViewResult;
    expect(res.columns.map((c) => c.key)).toEqual([
      'text',
      'normalizedText',
      'stage',
      'avgMonthlySearches',
    ]);
    expect(res.rows[0]).toMatchObject({ stage: 'spec_comparison' });
  });

  it('applies the shared FilterSpec + sort', () => {
    const rows = [
      jrow({ normalizedText: 'a', avgMonthlySearches: 100 }, 'pain_awareness'),
      jrow({ normalizedText: 'b', avgMonthlySearches: 300 }, 'final_decision'),
    ];
    const res = journeyView.build(
      ctx(rows, { view: 'journey', sort: [{ field: 'avgMonthlySearches', direction: 'desc' }] }),
    ) as TableViewResult;
    expect(res.rows.map((r) => r.stage)).toEqual(['final_decision', 'pain_awareness']);
  });

  it('requires the journey feature and reuses the shared filters', () => {
    expect(journeyView.requiresFeature).toBe('journey');
    expect(journeyView.allowedFilters).toContain('q');
  });
});

describe('journey_funnel view (chart, T12.6 / FR-33 / AC-33.4)', () => {
  it('returns all 7 stages in canonical funnel order with group counts (missing → 0)', () => {
    const rows = [
      jrow({ normalizedText: 'a' }, 'need_definition'),
      jrow({ normalizedText: 'b' }, 'need_definition'),
      jrow({ normalizedText: 'c' }, 'final_decision'),
    ];
    const res = journeyFunnelView.build(ctx(rows, { view: 'journey_funnel' })) as ChartViewResult;
    expect(res.view).toBe('journey_funnel');
    expect(res.groups.map((g) => g.key.stage)).toEqual([
      'pain_awareness',
      'need_definition',
      'solution_exploration',
      'spec_comparison',
      'reputation_validation',
      'final_decision',
      'repurchase_retention',
    ]);
    const counts = Object.fromEntries(res.groups.map((g) => [g.key.stage, g.measures.count]));
    expect(counts.need_definition).toBe(2);
    expect(counts.final_decision).toBe(1);
    expect(counts.pain_awareness).toBe(0); // 缺階 → 0
    expect(counts.repurchase_retention).toBe(0);
  });

  it('counts distinct keywords per stage (countDistinct normalizedText)', () => {
    const rows = [
      jrow({ normalizedText: 'a' }, 'spec_comparison'),
      jrow({ normalizedText: 'a' }, 'spec_comparison'), // 同 nt 重覆
    ];
    const res = journeyFunnelView.build(ctx(rows, { view: 'journey_funnel' })) as ChartViewResult;
    const spec = res.groups.find((g) => g.key.stage === 'spec_comparison');
    expect(spec?.measures.count).toBe(2);
    expect(spec?.measures.keywords).toBe(1);
  });

  it('ignores unclassified rows (no stage) — only the 7 canonical stages appear', () => {
    const rows = [jrow({ normalizedText: 'a' }), jrow({ normalizedText: 'b' }, 'final_decision')];
    const res = journeyFunnelView.build(ctx(rows, { view: 'journey_funnel' })) as ChartViewResult;
    expect(res.groups).toHaveLength(7);
    expect(res.groups.find((g) => g.key.stage === 'final_decision')?.measures.count).toBe(1);
  });
});
