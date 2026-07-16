import { NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../common/authenticated-user';
import type { SnapshotRowData } from '../keyword-analysis/result-snapshot.checksum';
import type { PrismaService } from '../prisma';
import { NotReadyException } from './not-ready.exception';
import type { QueryViewService } from './query-view.service';
import { SnapshotQueryService } from './snapshot-query.service';

const CONFIG = { maxPageSize: 200, aggMaxBuckets: 200, aggMaxGroups: 1000 };

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
    service: new SnapshotQueryService(prisma, viewService, CONFIG),
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
});
