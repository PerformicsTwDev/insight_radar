import { NotFoundException } from '@nestjs/common';
import type { SnapshotRowData } from '../keyword-analysis/result-snapshot.checksum';
import type { PrismaService } from '../prisma';
import { NotReadyException } from './not-ready.exception';
import type { QueryViewService } from './query-view.service';
import { SnapshotQueryService } from './snapshot-query.service';

const CONFIG = { maxPageSize: 200, aggMaxBuckets: 200, aggMaxGroups: 1000 };

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
): { service: SnapshotQueryService; viewQuery: jest.Mock; findMany: jest.Mock } {
  const findUnique = jest.fn(() => Promise.resolve(analysis));
  const findMany = jest.fn(() => Promise.resolve(rows.map((data) => ({ data }))));
  const prisma = {
    keywordAnalysis: { findUnique },
    snapshotRow: { findMany },
  } as unknown as PrismaService;
  const viewQuery = jest.fn((r: unknown) => ({ view: 'keywords', rows: r }));
  const viewService = { query: viewQuery } as unknown as QueryViewService;
  return { service: new SnapshotQueryService(prisma, viewService, CONFIG), viewQuery, findMany };
}

describe('SnapshotQueryService (T5.5 / FR-14)', () => {
  it('loads snapshot rows ordered by rowIndex and delegates to the view service with config limits', async () => {
    const { service, viewQuery, findMany } = build({ resultSnapshotId: 'snap-1' }, [srow('a')]);

    await service.query('an-1', { view: 'keywords' });

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
    );
  });

  it('loads the analysis snapshot rows in order', async () => {
    const { service } = build({ resultSnapshotId: 'snap-1' }, [srow('x'), srow('y')]);
    const rows = await service.loadSnapshot('an-1');
    expect(rows.map((r) => r.normalizedText)).toEqual(['x', 'y']);
  });

  it('listKeywords returns §6.4 { data, meta } with intent → intentLabels (T6.1)', async () => {
    const { service } = build({ resultSnapshotId: 'snap-1' }, [srow('a'), srow('b')]);
    const res = await service.listKeywords('an-1', {}, {}, {});
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
    );
    expect(res.data.map((r) => r.text)).toEqual(['b']); // volumeMin filters out a
  });

  it('throws 404 NotFoundException for an unknown analysis id (AC-6.5)', async () => {
    const { service, findMany } = build(null, []);
    await expect(service.loadSnapshot('unknown')).rejects.toBeInstanceOf(NotFoundException);
    expect(findMany).not.toHaveBeenCalled(); // 無分析 → 不查列
  });

  it('throws 409 NotReadyException when the analysis has no snapshot yet (AC-6.4)', async () => {
    const { service, findMany } = build({ status: 'running', resultSnapshotId: null }, []);
    await expect(service.loadSnapshot('running')).rejects.toBeInstanceOf(NotReadyException);
    expect(findMany).not.toHaveBeenCalled(); // 尚無 snapshot → 不查列、不回誤導資料
  });
});
