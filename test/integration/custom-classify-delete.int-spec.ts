import { NotFoundException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { AuthenticatedUser } from 'src/common/authenticated-user';
import type { IntentLabeler } from 'src/intent/intent-labeler.port';
import type { SnapshotQueryService } from 'src/keywords/snapshot-query.service';
import type { PrismaService } from 'src/prisma';
import { CustomClassifyService } from 'src/custom-classify/custom-classify.service';
import { createPrismaTestApp } from '../utils/create-prisma-test-app';

const RUN_ID = '44444444-4444-4444-4444-444444444444';

/**
 * TC-70 部分（T12.9 · FR-34/AC-34.5 · Testcontainers）：`CustomClassifyService.remove` 級聯刪除。驗真實 Postgres 下
 * 單一 `$transaction` 移除 `custom_classifications` + `keyword_custom_assignments` + `custom_classify_runs`（三表無
 * FK cascade、須顯式）；非 owner → 404 且不刪任何列。
 */
const API_ACTOR: AuthenticatedUser = { kind: 'apiKey' };
const SESSION_A: AuthenticatedUser = {
  kind: 'session',
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  email: 'a@x.com',
};
const AN = '11111111-1111-1111-1111-111111111111';
const CID = '22222222-2222-2222-2222-222222222222';
const SNAP = '33333333-3333-3333-3333-3333333333aa';

describe('CustomClassifyService.remove cascade (integration · Testcontainers, TC-70 部分)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: CustomClassifyService;
  let queueRemove: jest.Mock<Promise<number>, [string]>;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
    queueRemove = jest.fn<Promise<number>, [string]>().mockResolvedValue(1);
    service = new CustomClassifyService(
      {} as unknown as IntentLabeler,
      {} as unknown as SnapshotQueryService,
      prisma,
      { maxLabels: 12 },
      { remove: queueRemove } as unknown as Queue,
    );
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(async () => {
    queueRemove.mockClear();
    await prisma.$executeRawUnsafe('DELETE FROM keyword_custom_assignments');
    await prisma.$executeRawUnsafe('DELETE FROM custom_classify_runs');
    await prisma.$executeRawUnsafe('DELETE FROM custom_classifications');
    await prisma.$executeRawUnsafe('DELETE FROM keyword_analyses');
  });

  async function seed(ownerId: string | null): Promise<void> {
    await prisma.keywordAnalysis.create({
      data: {
        id: AN,
        status: 'completed',
        seeds: [],
        params: {},
        progress: {},
        idempotencyKey: `idem-${AN}`,
        ownerId,
      },
    });
    await prisma.customClassification.create({
      data: { id: CID, analysisId: AN, snapshotId: SNAP, name: 'N', instruction: 'i', labels: [] },
    });
    await prisma.keywordCustomAssignment.create({
      data: { classificationId: CID, normalizedText: 'coffee', label: 'transactional' },
    });
    await prisma.customClassifyRun.create({
      data: {
        id: RUN_ID,
        classificationId: CID,
        keywordAnalysisId: AN,
        snapshotId: SNAP,
        status: 'completed',
        params: {},
        idempotencyKey: `idem-run-${CID}`,
      },
    });
  }

  it('deletes the definition + assignments + runs in one transaction and cancels the run job', async () => {
    await seed(null);
    const out = await service.remove(AN, CID, API_ACTOR);
    expect(out).toEqual({ classificationId: CID });

    expect(await prisma.customClassification.count({ where: { id: CID } })).toBe(0);
    expect(await prisma.keywordCustomAssignment.count({ where: { classificationId: CID } })).toBe(
      0,
    );
    expect(await prisma.customClassifyRun.count({ where: { classificationId: CID } })).toBe(0);
    // M12-R5: the cid's run job (id = jobId), looked up from real Postgres, is cancelled before delete.
    expect(queueRemove).toHaveBeenCalledWith(RUN_ID);
  });

  it('rejects a non-owner session actor with 404 and deletes nothing', async () => {
    await seed('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'); // owned by someone else
    await expect(service.remove(AN, CID, SESSION_A)).rejects.toBeInstanceOf(NotFoundException);
    expect(await prisma.customClassification.count({ where: { id: CID } })).toBe(1); // untouched
    expect(await prisma.keywordCustomAssignment.count({ where: { classificationId: CID } })).toBe(
      1,
    );
  });
});
