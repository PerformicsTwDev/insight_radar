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

interface SnapshotRef {
  id: string;
  keywordCount: number;
  checksum: string;
}

interface Options {
  /** tx 內 status 守門讀到的列（預設非終態 running）。 */
  existing?: { status: string; resultSnapshot: SnapshotRef | null };
  /** 末筆 updateMany 命中列數（0 = 中途被轉終態 → 回滾）。 */
  updateCount?: number;
  /** 回滾後 tx 外回讀（race 用）。 */
  afterRollback?: { resultSnapshot: SnapshotRef | null };
}

function buildService(opts: Options = {}) {
  const captured = {} as {
    snapshot?: { data: { id: string; analysisId: string; keywordCount: number; checksum: string } };
    rows?: { data: Array<{ snapshotId: string; rowIndex: number; data: unknown }> };
    updateMany?: {
      where: { id: string; status: { notIn: string[] } };
      data: { status: string; progress?: { phase: string; percent: number; total?: number } };
    };
  };
  const create = jest.fn((args: NonNullable<typeof captured.snapshot>) => {
    captured.snapshot = args;
    return Promise.resolve();
  });
  const createMany = jest.fn((args: NonNullable<typeof captured.rows>) => {
    captured.rows = args;
    return Promise.resolve();
  });
  const updateMany = jest.fn((args: NonNullable<typeof captured.updateMany>) => {
    captured.updateMany = args;
    return Promise.resolve({ count: opts.updateCount ?? 1 });
  });
  const txFindUnique = jest
    .fn()
    .mockResolvedValue(opts.existing ?? { status: 'running', resultSnapshot: null });
  const outerFindUnique = jest
    .fn()
    .mockResolvedValue(opts.afterRollback ?? { resultSnapshot: null });

  const tx = {
    keywordAnalysis: { findUnique: txFindUnique, updateMany },
    resultSnapshot: { create },
    snapshotRow: { createMany },
  };
  const $transaction = jest.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
  const prisma = {
    keywordAnalysis: { findUnique: outerFindUnique },
    $transaction,
  } as unknown as PrismaService;

  return {
    service: new ResultSnapshotService(prisma),
    captured,
    create,
    updateMany,
    outerFindUnique,
    $transaction,
  };
}

describe('ResultSnapshotService.saveResult (T3.10 / FR-6 / NFR-7 / M3-R3)', () => {
  it('persists checksum + keywordCount, rows, and conditionally completes the analysis', async () => {
    const { service, captured, updateMany } = buildService();
    const rows = [row('coffee'), row('latte')];

    const out = await service.saveResult('a-1', rows);

    expect(captured.snapshot?.data.checksum).toBe(computeChecksum(rows));
    expect(captured.snapshot?.data.keywordCount).toBe(2);
    expect(captured.rows?.data).toHaveLength(2);
    // 條件更新：只在仍非終態時轉 completed（M3-R3 原子守門）。
    expect(captured.updateMany?.where.status.notIn).toEqual(
      expect.arrayContaining(['completed', 'failed', 'canceled']),
    );
    expect(captured.updateMany?.data.status).toBe('completed');
    // progress 與 status='completed' **同筆原子寫入**（M3-R5）：completed job 的 DB progress 達 intent/100，
    // 不再停在 processor 最後一筆 metrics/60（processor 的 report('intent') DB 鏡像因已終態會 no-op）。
    // total=keywordCount（M3-R6/#4）：與 in-flight frame 同形，completed 不丟分母。
    expect(captured.updateMany?.data.progress).toEqual({ phase: 'intent', percent: 100, total: 2 });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(out).toEqual({
      resultSnapshotId: captured.snapshot?.data.id,
      count: 2,
      checksum: computeChecksum(rows),
    });
  });

  it('runs the persistence transaction with an explicit timeout (M3-R6/#1)', async () => {
    // 大量 keyword + WORKER_CONCURRENCY>1 連線池競爭下，Prisma 預設 5s/maxWait 2s 太緊 → P2028 把已完成
    // 結果回滾重跑。互動式交易須帶顯式較寬上限。
    const { service, $transaction } = buildService();

    await service.saveResult('a-1', [row('coffee')]);

    const options = ($transaction.mock.calls[0] as unknown[])[1] as
      { maxWait?: number; timeout?: number } | undefined;
    expect(options?.timeout).toEqual(expect.any(Number));
    expect(options?.timeout).toBeGreaterThan(5000); // 寬於 Prisma 預設 5s
    expect(options?.maxWait).toEqual(expect.any(Number));
  });

  it('writes an empty snapshot (count 0) without rows', async () => {
    const { service, captured } = buildService();
    const out = await service.saveResult('a-2', []);
    expect(out.count).toBe(0);
    expect(captured.snapshot?.data.keywordCount).toBe(0);
    expect(captured.rows?.data).toHaveLength(0);
  });

  it('is idempotent under job retry: a completed analysis returns its existing snapshot, creates nothing', async () => {
    const { service, create } = buildService({
      existing: {
        status: 'completed',
        resultSnapshot: { id: 'snap-existing', keywordCount: 7, checksum: 'abc123' },
      },
    });

    const out = await service.saveResult('a-1', [row('coffee')]);

    expect(out).toEqual({ resultSnapshotId: 'snap-existing', count: 7, checksum: 'abc123' });
    expect(create).not.toHaveBeenCalled();
  });

  it('does not materialize a snapshot for an already-canceled/failed analysis (no-op)', async () => {
    const { service, create } = buildService({
      existing: { status: 'canceled', resultSnapshot: null },
    });

    const out = await service.saveResult('a-1', [row('coffee')]);

    expect(out).toEqual({ resultSnapshotId: null, count: 0, checksum: '' });
    expect(create).not.toHaveBeenCalled();
  });

  it('rolls back and does not resurrect when the job goes terminal mid-transaction (TOCTOU, M3-R3)', async () => {
    // tx 內守門讀到 running（未終態），但末筆 updateMany 命中 0 列 = cancel 在交易中途 commit canceled。
    const { service, updateMany } = buildService({
      existing: { status: 'running', resultSnapshot: null },
      updateCount: 0,
      afterRollback: { resultSnapshot: null }, // 回讀：canceled、無 snapshot
    });

    const out = await service.saveResult('a-1', [row('coffee')]);

    // 條件 updateMany 命中 0 → 拋出回滾 → **不**轉 completed（無 resurrection），回讀回 no-op。
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ resultSnapshotId: null, count: 0, checksum: '' });
  });

  it('re-throws an unexpected transaction error (not a terminal race)', async () => {
    const { service, create } = buildService();
    create.mockRejectedValueOnce(new Error('db down'));
    await expect(service.saveResult('a-1', [row('x')])).rejects.toThrow('db down');
  });
});
