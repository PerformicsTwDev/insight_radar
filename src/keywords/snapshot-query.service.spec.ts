import type { SnapshotRowData } from '../keyword-analysis/result-snapshot.checksum';
import type { PrismaService } from '../prisma';
import type { QueryViewService } from './query-view.service';
import { SnapshotQueryService } from './snapshot-query.service';

const CONFIG = { maxPageSize: 200, aggMaxBuckets: 200, aggMaxGroups: 1000 };

function srow(normalizedText: string): SnapshotRowData {
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
  };
}

function build(
  analysis: { resultSnapshotId: string | null } | null,
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

  it('returns empty rows for an unknown analysis id', async () => {
    const { service, findMany } = build(null, []);
    expect(await service.loadSnapshot('unknown')).toEqual([]);
    expect(findMany).not.toHaveBeenCalled(); // 無分析 → 不查列
  });

  it('returns empty rows when the analysis has no snapshot yet (not completed)', async () => {
    const { service, findMany } = build({ resultSnapshotId: null }, []);
    expect(await service.loadSnapshot('running')).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
