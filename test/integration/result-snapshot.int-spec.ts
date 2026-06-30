import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from 'src/prisma';
import {
  computeChecksum,
  type SnapshotRowData,
} from 'src/keyword-analysis/result-snapshot.checksum';
import { ResultSnapshotService } from 'src/keyword-analysis/result-snapshot.service';
import { createPrismaTestApp } from '../utils';

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

describe('ResultSnapshotService (integration · Testcontainers Postgres, TC-17/NFR-7)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: ResultSnapshotService;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
    service = new ResultSnapshotService(prisma);
  });

  afterAll(async () => {
    await app.close(); // onModuleDestroy → $disconnect
  });

  afterEach(async () => {
    await prisma.snapshotRow.deleteMany();
    await prisma.keywordAnalysis.updateMany({ data: { resultSnapshotId: null } }); // 解 FK 再刪 snapshot
    await prisma.resultSnapshot.deleteMany();
    await prisma.keywordAnalysis.deleteMany();
  });

  async function seedRunning(idempotencyKey: string): Promise<string> {
    const created = await prisma.keywordAnalysis.create({
      data: {
        status: 'running',
        seeds: ['x'],
        params: { mode: 'expand' },
        progress: { phase: 'running', percent: 50 },
        idempotencyKey,
      },
    });
    return created.id;
  }

  it('persists snapshot + rows on real Postgres and backfills FK + completed status', async () => {
    const analysisId = await seedRunning('idem-snap-1');
    const rows = [row('coffee'), row('latte')];

    const out = await service.saveResult(analysisId, rows);

    const snap = await prisma.resultSnapshot.findUnique({
      where: { id: out.resultSnapshotId },
      include: { rows: true },
    });
    expect(snap?.checksum).toBe(computeChecksum(rows)); // checksum + count 落 DB（非僅 Redis）
    expect(snap?.keywordCount).toBe(2);
    expect(snap?.rows).toHaveLength(2);

    const updated = await prisma.keywordAnalysis.findUnique({ where: { id: analysisId } });
    expect(updated?.status).toBe('completed');
    expect(updated?.resultSnapshotId).toBe(out.resultSnapshotId);
    expect(updated?.finishedAt).not.toBeNull();
  });

  it('is immutable/reproducible: rows read back from DB recompute the same checksum (NFR-7/TC-17)', async () => {
    const analysisId = await seedRunning('idem-snap-2');
    const rows = [row('a'), row('b'), row('c')];

    const out = await service.saveResult(analysisId, rows);

    const persisted = await prisma.snapshotRow.findMany({
      where: { snapshotId: out.resultSnapshotId },
      orderBy: { rowIndex: 'asc' },
    });
    const readBack = persisted.map((r) => r.data as unknown as SnapshotRowData);
    expect(readBack).toHaveLength(3);
    // 內容回讀後 checksum 不漂移 → snapshot 不可變/可重現。
    expect(computeChecksum(readBack)).toBe(out.checksum);
  });
});
