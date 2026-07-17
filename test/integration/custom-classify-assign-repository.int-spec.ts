import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from 'src/prisma';
import { CustomClassifyAssignRepository } from 'src/custom-classify/custom-classify-assign.repository';
import { createPrismaTestApp } from '../utils/create-prisma-test-app';

/**
 * TC-70 部分（T12.8 · FR-34/AC-34.3 · Testcontainers）：`keyword_custom_assignments` snapshot-scoped 持久化。
 * 驗 saveAssignments 插入、重跑覆寫（delete + insert）、單次呼叫去重（last-write-wins、無 PK 違反）、
 * 空輸入清空既有、classification 範圍隔離。以真 migration 建表 + `PrismaService` 直讀直存。
 */
const CID = '33333333-3333-3333-3333-333333333333';
const CID2 = '44444444-4444-4444-4444-444444444444';

describe('CustomClassifyAssignRepository (integration · Testcontainers, TC-70 部分)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repo: CustomClassifyAssignRepository;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
    repo = new CustomClassifyAssignRepository(prisma);
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM keyword_custom_assignments');
  });

  it('saveAssignments inserts assignment rows for the classification', async () => {
    await repo.saveAssignments(CID, [
      { normalizedText: 'running shoes', label: 'transactional' },
      { normalizedText: 'what are running shoes', label: 'informational' },
    ]);

    const rows = await prisma.keywordCustomAssignment.findMany({
      where: { classificationId: CID },
      orderBy: { normalizedText: 'asc' },
    });
    expect(rows.map((r) => ({ nt: r.normalizedText, label: r.label }))).toEqual([
      { nt: 'running shoes', label: 'transactional' },
      { nt: 'what are running shoes', label: 'informational' },
    ]);
  });

  it('rerun overwrites prior assignments for the same classification (delete + insert)', async () => {
    await repo.saveAssignments(CID, [
      { normalizedText: 'running shoes', label: 'transactional' },
      { normalizedText: 'trail shoes', label: 'transactional' },
    ]);
    await repo.saveAssignments(CID, [
      { normalizedText: 'running shoes', label: 'informational' }, // relabeled
      { normalizedText: 'hiking boots', label: 'transactional' }, // new keyword
    ]);

    const rows = await prisma.keywordCustomAssignment.findMany({
      where: { classificationId: CID },
      orderBy: { normalizedText: 'asc' },
    });
    // old-only 'trail shoes' gone; 'running shoes' relabeled; new 'hiking boots' present.
    expect(rows.map((r) => r.normalizedText)).toEqual(['hiking boots', 'running shoes']);
    expect(rows.find((r) => r.normalizedText === 'running shoes')?.label).toBe('informational');
  });

  it('dedupes duplicate normalizedText within one call (last-write-wins, no PK violation)', async () => {
    await repo.saveAssignments(CID, [
      { normalizedText: 'running shoes', label: 'informational' },
      { normalizedText: 'running shoes', label: 'transactional' }, // duplicate PK → last wins
    ]);

    const rows = await prisma.keywordCustomAssignment.findMany({
      where: { classificationId: CID },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('transactional');
  });

  it('empty assignments clears prior rows (delete still runs)', async () => {
    await repo.saveAssignments(CID, [{ normalizedText: 'running shoes', label: 'transactional' }]);
    await repo.saveAssignments(CID, []);

    expect(await prisma.keywordCustomAssignment.count({ where: { classificationId: CID } })).toBe(
      0,
    );
  });

  it('is scoped to the classification (does not touch other classifications)', async () => {
    await repo.saveAssignments(CID2, [{ normalizedText: 'kept', label: 'other' }]);
    await repo.saveAssignments(CID, [{ normalizedText: 'a', label: 'x' }]);
    await repo.saveAssignments(CID, []); // clears CID only

    expect(await prisma.keywordCustomAssignment.count({ where: { classificationId: CID } })).toBe(
      0,
    );
    expect(await prisma.keywordCustomAssignment.count({ where: { classificationId: CID2 } })).toBe(
      1,
    );
  });
});
