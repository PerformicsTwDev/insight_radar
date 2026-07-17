import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from 'src/prisma';
import { createPrismaTestApp } from '../utils/create-prisma-test-app';

/**
 * TC-70 部分（T12.7 · FR-34/AC-34.1 · Testcontainers）：`custom_classifications` 持久層。驗真實 migration 建表 +
 * JSONB `labels` 陣列 round-trip（`[{label,description}]` 原樣取回）+ `created_at` 預設 + `keyword_analysis_id`
 * 索引存在。以 `PrismaService` 直存直讀（服務層 owner/LLM 分支由 unit/e2e 把關）。
 */
const AN = '11111111-1111-1111-1111-111111111111';
const SNAP = '22222222-2222-2222-2222-2222222222aa';

describe('custom_classifications persistence (integration · Testcontainers, TC-70 部分)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM custom_classifications');
  });

  it('persists a definition and round-trips the JSONB labels array unchanged', async () => {
    const labels = [
      { label: 'transactional', description: 'buy intent' },
      { label: 'informational', description: 'research intent' },
    ];
    const row = await prisma.customClassification.create({
      data: {
        analysisId: AN,
        snapshotId: SNAP,
        name: 'Funnel',
        instruction: 'group by purchase intent',
        labels,
      },
    });

    expect(row.id).toEqual(expect.any(String));
    expect(row.createdAt).toBeInstanceOf(Date); // created_at DEFAULT CURRENT_TIMESTAMP

    const reread = await prisma.customClassification.findUniqueOrThrow({ where: { id: row.id } });
    expect(reread.analysisId).toBe(AN);
    expect(reread.snapshotId).toBe(SNAP);
    expect(reread.name).toBe('Funnel');
    expect(reread.instruction).toBe('group by purchase intent');
    expect(reread.labels).toEqual(labels); // JSONB array preserved (order + nested shape)
  });

  it('supports multiple definitions per analysis (no unique-per-analysis constraint; HITL may create several)', async () => {
    await prisma.customClassification.create({
      data: { analysisId: AN, snapshotId: SNAP, name: 'A', instruction: 'i1', labels: [] },
    });
    await prisma.customClassification.create({
      data: { analysisId: AN, snapshotId: SNAP, name: 'B', instruction: 'i2', labels: [] },
    });
    expect(await prisma.customClassification.count({ where: { analysisId: AN } })).toBe(2);
  });

  it('exposes the keyword_analysis_id index for lookups by analysis', async () => {
    const idx = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'custom_classifications'`,
    );
    const names = idx.map((r) => r.indexname);
    expect(names).toContain('custom_classifications_keyword_analysis_id_idx');
  });
});
