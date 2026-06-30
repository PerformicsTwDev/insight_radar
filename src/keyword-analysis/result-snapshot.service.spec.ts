import { computeChecksum, type SnapshotRowData } from './result-snapshot.checksum';
import { ResultSnapshotService } from './result-snapshot.service';
import type { PrismaService } from '../prisma';

function row(normalizedText: string): SnapshotRowData {
  return {
    text: normalizedText,
    normalizedText,
    avgMonthlySearches: 100,
    competition: 'LOW',
    competitionIndex: 5,
    cpcLow: 1,
    cpcHigh: 2,
    intent: ['informational'],
  };
}

interface Captured {
  snapshot: { data: { id: string; analysisId: string; keywordCount: number; checksum: string } };
  rows: {
    data: Array<{ snapshotId: string; analysisId: string; rowIndex: number; data: unknown }>;
  };
  analysisUpdate: {
    where: { id: string };
    data: { resultSnapshotId: string; status: string; finishedAt: Date };
  };
}

function buildService() {
  const captured = {} as Captured;
  const create = jest.fn((args: Captured['snapshot']) => {
    captured.snapshot = args;
    return 'snapshot-op';
  });
  const createMany = jest.fn((args: Captured['rows']) => {
    captured.rows = args;
    return 'rows-op';
  });
  const update = jest.fn((args: Captured['analysisUpdate']) => {
    captured.analysisUpdate = args;
    return 'update-op';
  });
  const $transaction = jest.fn().mockResolvedValue([]);
  // 預設：分析尚未完成（無既有 snapshot）→ saveResult 正常建立。
  const findUnique = jest.fn().mockResolvedValue({ status: 'running', resultSnapshot: null });
  const prisma = {
    resultSnapshot: { create },
    snapshotRow: { createMany },
    keywordAnalysis: { update, findUnique },
    $transaction,
  } as unknown as PrismaService;
  return { service: new ResultSnapshotService(prisma), captured, $transaction, create, findUnique };
}

describe('ResultSnapshotService.saveResult (T3.10 / FR-6 / NFR-7)', () => {
  it('persists checksum + keywordCount to result_snapshots and backfills the analysis FK + completed status', async () => {
    const { service, captured, $transaction } = buildService();
    const rows = [row('coffee'), row('latte')];

    const out = await service.saveResult('a-1', rows);

    // 落 DB：checksum + keywordCount 必在 result_snapshots（NFR-7，非僅 Redis）。
    expect(captured.snapshot.data.checksum).toBe(computeChecksum(rows));
    expect(captured.snapshot.data.keywordCount).toBe(2);
    expect(captured.snapshot.data.analysisId).toBe('a-1');

    // snapshot_rows：每列含 rowIndex + data。
    expect(captured.rows.data).toHaveLength(2);
    expect(captured.rows.data[0]).toMatchObject({ snapshotId: out.resultSnapshotId, rowIndex: 0 });
    expect(captured.rows.data[1].rowIndex).toBe(1);

    // job 回填 FK + status='completed'。
    expect(captured.analysisUpdate.where.id).toBe('a-1');
    expect(captured.analysisUpdate.data.resultSnapshotId).toBe(out.resultSnapshotId);
    expect(captured.analysisUpdate.data.status).toBe('completed');

    // 三寫一致的 snapshot id + 原子交易。
    expect(captured.snapshot.data.id).toBe(out.resultSnapshotId);
    expect($transaction).toHaveBeenCalledTimes(1);

    expect(out).toEqual({
      resultSnapshotId: captured.snapshot.data.id,
      count: 2,
      checksum: computeChecksum(rows),
    });
  });

  it('writes an empty snapshot (count 0) without creating rows', async () => {
    const { service, captured } = buildService();
    const out = await service.saveResult('a-2', []);
    expect(out.count).toBe(0);
    expect(captured.snapshot.data.keywordCount).toBe(0);
    expect(captured.rows.data).toHaveLength(0);
  });

  it('is idempotent under job retry: returns the existing snapshot, creates nothing (M2)', async () => {
    const { service, create, findUnique, $transaction } = buildService();
    // 重試時分析已 completed 且有 snapshot → 不得重建（否則孤兒 rows + FK 漂移）。
    findUnique.mockResolvedValueOnce({
      status: 'completed',
      resultSnapshot: { id: 'snap-existing', keywordCount: 7, checksum: 'abc123' },
    });

    const out = await service.saveResult('a-1', [row('coffee')]);

    expect(out).toEqual({ resultSnapshotId: 'snap-existing', count: 7, checksum: 'abc123' });
    expect(create).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });
});
