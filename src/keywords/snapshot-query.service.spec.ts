import { NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../common/authenticated-user';
import type { SnapshotRowData } from '../keyword-analysis/result-snapshot.checksum';
import type { PrismaService } from '../prisma';
import type { AiViewRepository } from './ai-view.repository';
import { FeatureNotReadyException } from './feature-not-ready.exception';
import { NotReadyException } from './not-ready.exception';
import type { QueryViewService } from './query-view.service';
import { SnapshotQueryService } from './snapshot-query.service';

const CONFIG = { maxPageSize: 200, aggMaxBuckets: 200, aggMaxGroups: 1000 };

/** AI view repo 存根：既有（keywords/journey/custom）測試不觸 AI 路徑，回空 run/列（不被呼叫）。 */
function aiRepoStub(over: Partial<AiViewRepository> = {}): AiViewRepository {
  return {
    findLatestLinkedRun: jest.fn().mockResolvedValue(null),
    findAnswers: jest.fn().mockResolvedValue([]),
    findCited: jest.fn().mockResolvedValue([]),
    findMetrics: jest.fn().mockResolvedValue([]),
    ...over,
  } as unknown as AiViewRepository;
}

/** 機器 actor（x-api-key）：不套 owner 過濾——這些既有測試驗讀取層行為（非 owner），用機器身分。 */
const API_ACTOR: AuthenticatedUser = { kind: 'apiKey' };

function srow(normalizedText: string, over: Partial<SnapshotRowData> = {}): SnapshotRowData {
  return {
    text: normalizedText,
    normalizedText,
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

function build(
  analysis: { status?: string; resultSnapshotId: string | null } | null,
  rows: SnapshotRowData[],
  assertExecutable: jest.Mock = jest.fn(),
): {
  service: SnapshotQueryService;
  viewQuery: jest.Mock;
  findMany: jest.Mock;
  assertExecutable: jest.Mock;
} {
  const findUnique = jest.fn(() => Promise.resolve(analysis));
  const findMany = jest.fn(() => Promise.resolve(rows.map((data) => ({ data }))));
  const prisma = {
    keywordAnalysis: { findUnique },
    snapshotRow: { findMany },
  } as unknown as PrismaService;
  const viewQuery = jest.fn((r: unknown) => ({ view: 'keywords', rows: r }));
  // assertExecutable：M6-R6，query() 於 loadRows 前呼叫做 unknown-view/feature gate。
  const viewService = { query: viewQuery, assertExecutable } as unknown as QueryViewService;
  return {
    service: new SnapshotQueryService(prisma, viewService, aiRepoStub(), CONFIG),
    viewQuery,
    findMany,
    assertExecutable,
  };
}

describe('SnapshotQueryService (T5.5 / FR-14)', () => {
  it('loads snapshot rows ordered by rowIndex and delegates to the view service with config limits', async () => {
    const { service, viewQuery, findMany } = build({ resultSnapshotId: 'snap-1' }, [srow('a')]);

    await service.query('an-1', { view: 'keywords' }, API_ACTOR);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { snapshotId: 'snap-1' },
        orderBy: { rowIndex: 'asc' },
      }),
    );
    expect(viewQuery).toHaveBeenCalledWith(
      [expect.objectContaining({ normalizedText: 'a' })],
      { view: 'keywords' },
      { maxPageSize: 200, aggMaxBuckets: 200, aggMaxGroups: 1000 },
      // T6.8：query 傳入 features（snapshot 存在 → keyword_metrics ready），供 view-router feature-gating。
      expect.objectContaining({ keyword_metrics: { status: 'ready' } }),
    );
  });

  it('gates (assertExecutable) BEFORE loading rows — a gated view does not read the snapshot (M6-R6)', async () => {
    const boom = new Error('gated');
    const assertExecutable = jest.fn(() => {
      throw boom;
    });
    const { service, findMany, viewQuery } = build(
      { status: 'completed', resultSnapshotId: 'snap-1' },
      [srow('a')],
      assertExecutable,
    );

    await expect(service.query('an-1', { view: 'serp_questions' }, API_ACTOR)).rejects.toBe(boom);

    expect(assertExecutable).toHaveBeenCalledWith(
      'serp_questions',
      expect.objectContaining({ keyword_metrics: { status: 'ready' } }),
    );
    expect(findMany).not.toHaveBeenCalled(); // 未載入 snapshot 列（gate 先擋）
    expect(viewQuery).not.toHaveBeenCalled();
  });

  it('loads the analysis snapshot rows in order', async () => {
    const { service } = build({ resultSnapshotId: 'snap-1' }, [srow('x'), srow('y')]);
    const rows = await service.loadSnapshot('an-1', API_ACTOR);
    expect(rows.map((r) => r.normalizedText)).toEqual(['x', 'y']);
  });

  it('listKeywords returns §6.4 { data, meta } with intent → intentLabels (T6.1)', async () => {
    const { service } = build({ resultSnapshotId: 'snap-1' }, [srow('a'), srow('b')]);
    const res = await service.listKeywords('an-1', {}, {}, {}, API_ACTOR);
    expect(res.data.map((r) => r.text)).toEqual(['a', 'b']); // nt tie-break（同搜量）
    expect(res.data[0]).toEqual({
      text: 'a',
      intentLabels: ['informational'], // snapshot intent → 對外 intentLabels
      avgMonthlySearches: 100,
      competition: 'LOW',
      competitionIndex: 10,
      cpcLow: 1,
      cpcHigh: 2,
    });
    expect(res.meta).toMatchObject({ total: 2, page: 1 });
  });

  it('listKeywords applies the shared FilterSpec + sort', async () => {
    const { service } = build({ resultSnapshotId: 'snap-1' }, [
      srow('a', { avgMonthlySearches: 100 }),
      srow('b', { avgMonthlySearches: 300 }),
    ]);
    const res = await service.listKeywords(
      'an-1',
      { volumeMin: 200 },
      { sortBy: 'avgMonthlySearches', sortDir: 'desc' },
      {},
      API_ACTOR,
    );
    expect(res.data.map((r) => r.text)).toEqual(['b']); // volumeMin filters out a
  });

  it('throws 404 NotFoundException for an unknown analysis id (AC-6.5)', async () => {
    const { service, findMany } = build(null, []);
    await expect(service.loadSnapshot('unknown', API_ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findMany).not.toHaveBeenCalled(); // 無分析 → 不查列
  });

  it('throws 409 NotReadyException when the analysis has no snapshot yet (AC-6.4)', async () => {
    const { service, findMany } = build({ status: 'running', resultSnapshotId: null }, []);
    await expect(service.loadSnapshot('running', API_ACTOR)).rejects.toBeInstanceOf(
      NotReadyException,
    );
    expect(findMany).not.toHaveBeenCalled(); // 尚無 snapshot → 不查列、不回誤導資料
  });

  describe('resolveReadySnapshotId (owner-scoped snapshot id; no row load)', () => {
    it('returns the ready snapshot id without loading any rows', async () => {
      const { service, findMany } = build({ resultSnapshotId: 'snap-1' }, [srow('a')]);
      await expect(service.resolveReadySnapshotId('an-1', API_ACTOR)).resolves.toBe('snap-1');
      expect(findMany).not.toHaveBeenCalled(); // 只解析 id、不載列
    });

    it('throws 404 for an unknown analysis id (owner-scope single point)', async () => {
      const { service } = build(null, []);
      await expect(service.resolveReadySnapshotId('unknown', API_ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws 409 NotReadyException when no snapshot exists yet', async () => {
      const { service } = build({ status: 'running', resultSnapshotId: null }, []);
      await expect(service.resolveReadySnapshotId('running', API_ACTOR)).rejects.toBeInstanceOf(
        NotReadyException,
      );
    });
  });

  describe('custom:{cid} dynamic view (T12.9 / FR-34 / AC-34.3)', () => {
    const CID = '22222222-2222-2222-2222-222222222222';
    const AN = '11111111-1111-1111-1111-111111111111';

    function buildCustom(
      over: {
        classification?: unknown;
        runStatus?: string | null;
        assignments?: { normalizedText: string; label: string }[];
        rows?: SnapshotRowData[];
      } = {},
    ) {
      const kaFindUnique = jest.fn(() =>
        Promise.resolve({ status: 'completed', resultSnapshotId: 'snap-1', ownerId: null }),
      );
      const ccFindUnique = jest.fn(() =>
        Promise.resolve('classification' in over ? over.classification : { analysisId: AN }),
      );
      const ccrFindFirst = jest.fn(() =>
        Promise.resolve(
          over.runStatus === undefined
            ? { status: 'completed' }
            : over.runStatus === null
              ? null
              : { status: over.runStatus },
        ),
      );
      const kcaFindMany = jest.fn(() => Promise.resolve(over.assignments ?? []));
      const srFindMany = jest.fn(() =>
        Promise.resolve((over.rows ?? [srow('a')]).map((data) => ({ data }))),
      );
      const prisma = {
        keywordAnalysis: { findUnique: kaFindUnique },
        customClassification: { findUnique: ccFindUnique },
        customClassifyRun: { findFirst: ccrFindFirst },
        keywordCustomAssignment: { findMany: kcaFindMany },
        snapshotRow: { findMany: srFindMany },
      } as unknown as PrismaService;
      const queryWithView = jest.fn((rows: unknown) => ({ view: `custom:${CID}`, rows }));
      const viewService = {
        query: jest.fn(),
        assertExecutable: jest.fn(),
        queryWithView,
      } as unknown as QueryViewService;
      return {
        service: new SnapshotQueryService(prisma, viewService, aiRepoStub(), CONFIG),
        queryWithView,
        ccFindUnique,
        kcaFindMany,
      };
    }

    it('resolves the dynamic view, left-joins label by classificationId, and queries via queryWithView', async () => {
      const { service, queryWithView, kcaFindMany } = buildCustom({
        assignments: [{ normalizedText: 'a', label: 'transactional' }],
        rows: [srow('a'), srow('b')],
      });
      await service.query(AN, { view: `custom:${CID}` }, API_ACTOR);
      // label joined by classificationId (not snapshotId); unassigned 'b' → label undefined.
      expect(kcaFindMany).toHaveBeenCalledWith({
        where: { classificationId: CID },
        select: { normalizedText: true, label: true },
      });
      const rowsArg = queryWithView.mock.calls[0][0] as SnapshotRowData[];
      expect(rowsArg.map((r) => (r as unknown as { label?: string }).label)).toEqual([
        'transactional',
        undefined,
      ]);
    });

    it('returns 404 for an unknown classification id', async () => {
      const { service } = buildCustom({ classification: null });
      await expect(service.query(AN, { view: `custom:${CID}` }, API_ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns 404 when the classification belongs to a different analysis (IDOR)', async () => {
      const { service, ccFindUnique } = buildCustom({ classification: { analysisId: 'other-an' } });
      await expect(service.query(AN, { view: `custom:${CID}` }, API_ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(ccFindUnique).toHaveBeenCalled();
    });

    it('returns 404 for a non-UUID cid without hitting the DB (avoids Prisma P2023 → 500)', async () => {
      const { service, ccFindUnique } = buildCustom();
      await expect(
        service.query(AN, { view: 'custom:not-a-uuid' }, API_ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ccFindUnique).not.toHaveBeenCalled();
    });

    it('returns 409 FEATURE_NOT_READY when there is no completed classify run', async () => {
      const running = buildCustom({ runStatus: 'running' });
      await expect(
        running.service.query(AN, { view: `custom:${CID}` }, API_ACTOR),
      ).rejects.toMatchObject({ status: 409 });

      const none = buildCustom({ runStatus: null });
      await expect(
        none.service.query(AN, { view: `custom:${CID}` }, API_ACTOR),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('AI Search views (#678 G2 · gate flip + load path)', () => {
    const AN = 'an-ai';
    function buildAi(
      over: {
        run?: { id: string; status: string } | null;
        answers?: unknown[];
        cited?: unknown[];
        metrics?: unknown[];
        assertExecutable?: jest.Mock;
      } = {},
    ) {
      const kaFindUnique = jest.fn().mockResolvedValue({
        status: 'completed',
        resultSnapshotId: 'snap-1',
        ownerId: null,
      });
      const prisma = { keywordAnalysis: { findUnique: kaFindUnique } } as unknown as PrismaService;
      const findLatestLinkedRun = jest
        .fn()
        .mockResolvedValue('run' in over ? over.run : { id: 'run-ai', status: 'completed' });
      const findAnswers = jest.fn().mockResolvedValue(over.answers ?? []);
      const findCited = jest.fn().mockResolvedValue(over.cited ?? []);
      const findMetrics = jest.fn().mockResolvedValue(over.metrics ?? []);
      const aiRepo = aiRepoStub({ findLatestLinkedRun, findAnswers, findCited, findMetrics });
      const queryWithView = jest.fn(
        (rows: unknown, _r: unknown, _l: unknown, view: { name: string }) => ({
          view: view.name,
          rows,
        }),
      );
      const assertExecutable = over.assertExecutable ?? jest.fn((name: string) => ({ name }));
      const viewService = {
        query: jest.fn(),
        assertExecutable,
        queryWithView,
      } as unknown as QueryViewService;
      return {
        service: new SnapshotQueryService(prisma, viewService, aiRepo, CONFIG),
        findLatestLinkedRun,
        findAnswers,
        findCited,
        findMetrics,
        queryWithView,
        assertExecutable,
      };
    }

    it('resolves latest linked run (owner-scoped), gates, loads ai_answers, queries via queryWithView', async () => {
      const { service, findLatestLinkedRun, findAnswers, queryWithView } = buildAi({
        answers: [{ id: 'a1' }],
      });
      await service.query(AN, { view: 'ai_answers' }, API_ACTOR);
      expect(findLatestLinkedRun).toHaveBeenCalledWith(AN, {}); // apiKey → ownerWhere = {}
      expect(findAnswers).toHaveBeenCalledWith('run-ai');
      const rowsArg = queryWithView.mock.calls[0][0] as unknown[];
      expect(rowsArg).toEqual([{ id: 'a1' }]);
    });

    it('loads ai_cited_references for cited-media/cited-pages views', async () => {
      const { service, findCited } = buildAi({ cited: [{ id: 'c1' }] });
      await service.query(AN, { view: 'ai_cited_pages' }, API_ACTOR);
      expect(findCited).toHaveBeenCalledWith('run-ai');
    });

    it('loads ai_visibility_metrics filtered by the view dimension', async () => {
      const { service, findMetrics } = buildAi({ metrics: [{ id: 'm1' }] });
      await service.query(AN, { view: 'intent_ai_visibility' }, API_ACTOR);
      expect(findMetrics).toHaveBeenCalledWith('run-ai', 'intent');
    });

    it('gates 409 (assertExecutable throws for a not-ready feature) — no data loaded', async () => {
      const gate = jest.fn(() => {
        throw new FeatureNotReadyException('ai_search', 'not_generated');
      });
      const { service, findAnswers } = buildAi({ run: null, assertExecutable: gate });
      await expect(service.query(AN, { view: 'ai_answers' }, API_ACTOR)).rejects.toBeInstanceOf(
        FeatureNotReadyException,
      );
      expect(findAnswers).not.toHaveBeenCalled();
    });

    it('defensive guard: feature-gate passes but no run resolved → 409 (never loads)', async () => {
      // 理論不可達（ready ⟹ run 非 null）；以 non-throwing assertExecutable + null run 觸發防禦分支。
      const { service, findAnswers } = buildAi({
        run: null,
        assertExecutable: jest.fn((name: string) => ({ name })),
      });
      await expect(service.query(AN, { view: 'ai_answers' }, API_ACTOR)).rejects.toBeInstanceOf(
        FeatureNotReadyException,
      );
      expect(findAnswers).not.toHaveBeenCalled();
    });
  });

  describe('resolveViewDataVersion (M12-R3 · AI-insight cache data version)', () => {
    function buildVersion(
      over: {
        customRun?: { id: string } | null;
        journeyRun?: { id: string } | null;
        aiRun?: { id: string } | null;
      } = {},
    ) {
      const ccrFindFirst = jest.fn().mockResolvedValue(over.customRun ?? null);
      const jrFindFirst = jest.fn().mockResolvedValue(over.journeyRun ?? null);
      const airFindFirst = jest.fn().mockResolvedValue(over.aiRun ?? null);
      const prisma = {
        customClassifyRun: { findFirst: ccrFindFirst },
        journeyRun: { findFirst: jrFindFirst },
        aiSearchRun: { findFirst: airFindFirst },
      } as unknown as PrismaService;
      const service = new SnapshotQueryService(
        prisma,
        {} as unknown as QueryViewService,
        aiRepoStub(),
        CONFIG,
      );
      return { service, ccrFindFirst, jrFindFirst, airFindFirst };
    }

    const CID_UUID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const SESSION_ACTOR: AuthenticatedUser = { kind: 'session', id: 'user-1', email: 'u@x.com' };

    it('custom:{cid} → latest COMPLETED CustomClassifyRun.id, owner-scoped by keywordAnalysisId', async () => {
      const { service, ccrFindFirst } = buildVersion({ customRun: { id: 'run-c' } });
      expect(await service.resolveViewDataVersion('an-1', `custom:${CID_UUID}`, API_ACTOR)).toBe(
        'run-c',
      );
      expect(ccrFindFirst).toHaveBeenCalledWith({
        where: { classificationId: CID_UUID, keywordAnalysisId: 'an-1', status: 'completed' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
    });

    it('custom:{non-uuid cid} → "" WITHOUT hitting Prisma (no P2023 → 500; M12-R3 blocker fix)', async () => {
      const { service, ccrFindFirst } = buildVersion({ customRun: { id: 'run-c' } });
      expect(await service.resolveViewDataVersion('an-1', 'custom:not-a-uuid', API_ACTOR)).toBe('');
      expect(ccrFindFirst).not.toHaveBeenCalled(); // guarded before the @db.Uuid query
    });

    it('journey / journey_funnel → latest COMPLETED/PARTIAL JourneyRun.id (owner-agnostic: JourneyRun has no ownerId)', async () => {
      const { service, jrFindFirst } = buildVersion({ journeyRun: { id: 'run-j' } });
      // journey run 模型無 ownerId → owner-agnostic；session actor 亦不加 owner filter（data path 同 owner-agnostic）。
      expect(await service.resolveViewDataVersion('an-1', 'journey', SESSION_ACTOR)).toBe('run-j');
      expect(await service.resolveViewDataVersion('an-1', 'journey_funnel', SESSION_ACTOR)).toBe(
        'run-j',
      );
      expect(jrFindFirst).toHaveBeenCalledWith({
        where: { keywordAnalysisId: 'an-1', status: { in: ['completed', 'partial'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
    });

    it('AI Search view (apiKey) → GLOBAL latest COMPLETED/PARTIAL linked AiSearchRun.id (AC-27.5)', async () => {
      const { service, airFindFirst } = buildVersion({ aiRun: { id: 'run-ai' } });
      // apiKey → ownerWhere = {} → 全域最新（機器 actor 不隔離，維持 M9 前語意）。
      expect(await service.resolveViewDataVersion('an-1', 'ai_answers', API_ACTOR)).toBe('run-ai');
      expect(await service.resolveViewDataVersion('an-1', 'brand_ai_visibility', API_ACTOR)).toBe(
        'run-ai',
      );
      expect(airFindFirst).toHaveBeenCalledWith({
        where: { keywordAnalysisId: 'an-1', status: { in: ['completed', 'partial'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
    });

    it('AI Search view (session) → OWNER-SCOPED latest run (M15-R11: prevents cross-owner cache leak)', async () => {
      const { service, airFindFirst } = buildVersion({ aiRun: { id: 'run-ai' } });
      // session → dataVersion 解析必 owner-scoped（`...ownerWhere(actor)`）→ per-owner run.id → cache key 分家。
      expect(await service.resolveViewDataVersion('an-1', 'ai_answers', SESSION_ACTOR)).toBe(
        'run-ai',
      );
      expect(airFindFirst).toHaveBeenCalledWith({
        where: {
          keywordAnalysisId: 'an-1',
          status: { in: ['completed', 'partial'] },
          OR: [{ ownerId: 'user-1' }, { ownerId: null }],
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
    });

    it('returns "" when a dynamic view has no completed run yet (valid cid, null run)', async () => {
      const { service, ccrFindFirst } = buildVersion(); // both findFirst → null
      expect(await service.resolveViewDataVersion('an-1', `custom:${CID_UUID}`, API_ACTOR)).toBe(
        '',
      );
      expect(ccrFindFirst).toHaveBeenCalled(); // valid UUID → query ran, returned null
      expect(await service.resolveViewDataVersion('an-1', 'journey', API_ACTOR)).toBe('');
      expect(await service.resolveViewDataVersion('an-1', 'ai_answers', API_ACTOR)).toBe('');
    });

    it('returns "" for a static view without any DB round-trip', async () => {
      const { service, ccrFindFirst, jrFindFirst, airFindFirst } = buildVersion();
      expect(await service.resolveViewDataVersion('an-1', 'keywords', API_ACTOR)).toBe('');
      expect(ccrFindFirst).not.toHaveBeenCalled();
      expect(jrFindFirst).not.toHaveBeenCalled();
      expect(airFindFirst).not.toHaveBeenCalled();
    });
  });
});
