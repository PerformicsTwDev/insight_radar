import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from 'src/prisma';
import { CustomClassifyRunRepository } from 'src/custom-classify/custom-classify-run.repository';
import type { CustomClassifyRunParams } from 'src/custom-classify/custom-classify-run.types';
import { createPrismaTestApp } from '../utils/create-prisma-test-app';

/**
 * TC-70 部分（T12.8 · FR-34/AC-34.2 · Testcontainers）：CustomClassifyRun 生命週期 + idempotency。
 * 驗 createRun（queued）、idempotencyKey 命中回既有（不重建）、findByIdempotencyKey、markStatus
 * （undefined 欄位不覆寫）、updateProgress、findLatestRunByClassification（createdAt desc / 無→null）。
 */
const CID = '33333333-3333-3333-3333-333333333333';
const AN = '11111111-1111-1111-1111-111111111111';
const SNAP = '22222222-2222-2222-2222-2222222222aa';
const PARAMS: CustomClassifyRunParams = {
  schemaVersion: 'v1',
  deployment: 'gpt-4o-mini',
  labelsHash: 'h1',
};

describe('CustomClassifyRunRepository (integration · Testcontainers, TC-70 部分)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repo: CustomClassifyRunRepository;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
    repo = new CustomClassifyRunRepository(prisma);
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM custom_classify_runs');
  });

  it('createRun creates a queued run; a second call with the same idempotencyKey returns the existing run', async () => {
    const first = await repo.createRun({
      classificationId: CID,
      keywordAnalysisId: AN,
      snapshotId: SNAP,
      idempotencyKey: 'k-1',
      params: PARAMS,
    });
    expect(first.created).toBe(true);

    const row = await prisma.customClassifyRun.findUniqueOrThrow({ where: { id: first.runId } });
    expect(row.status).toBe('queued');
    expect(row.classificationId).toBe(CID);
    expect(row.keywordAnalysisId).toBe(AN);
    expect(row.progress).toBeNull(); // model progress is nullable → created as NULL

    const second = await repo.createRun({
      classificationId: CID,
      keywordAnalysisId: AN,
      snapshotId: SNAP,
      idempotencyKey: 'k-1',
      params: PARAMS,
    });
    expect(second).toEqual({ runId: first.runId, created: false }); // idempotent, no new run
    expect(await prisma.customClassifyRun.count()).toBe(1);
  });

  it('findByIdempotencyKey returns {id,status} or null', async () => {
    const { runId } = await repo.createRun({
      classificationId: CID,
      keywordAnalysisId: AN,
      snapshotId: SNAP,
      idempotencyKey: 'k-2',
      params: PARAMS,
    });
    expect(await repo.findByIdempotencyKey('k-2')).toEqual({ id: runId, status: 'queued' });
    expect(await repo.findByIdempotencyKey('nope')).toBeNull();
  });

  it('markStatus updates status + keywordCount + error (undefined fields untouched)', async () => {
    const { runId } = await repo.createRun({
      classificationId: CID,
      keywordAnalysisId: AN,
      snapshotId: SNAP,
      idempotencyKey: 'k-3',
      params: PARAMS,
    });
    await repo.markStatus(runId, 'running');
    expect(
      (await prisma.customClassifyRun.findUniqueOrThrow({ where: { id: runId } })).status,
    ).toBe('running');

    await repo.markStatus(runId, 'completed', { keywordCount: 42 });
    const done = await prisma.customClassifyRun.findUniqueOrThrow({ where: { id: runId } });
    expect(done.status).toBe('completed');
    expect(done.keywordCount).toBe(42);

    await repo.markStatus(runId, 'failed', { error: 'boom' });
    const failed = await prisma.customClassifyRun.findUniqueOrThrow({ where: { id: runId } });
    expect(failed.error).toBe('boom');
    expect(failed.keywordCount).toBe(42); // undefined keywordCount → not overwritten
  });

  it('updateProgress persists the progress JSON', async () => {
    const { runId } = await repo.createRun({
      classificationId: CID,
      keywordAnalysisId: AN,
      snapshotId: SNAP,
      idempotencyKey: 'k-4',
      params: PARAMS,
    });
    await repo.updateProgress(runId, { phase: 'classifying', percent: 50 });
    const row = await prisma.customClassifyRun.findUniqueOrThrow({ where: { id: runId } });
    expect(row.progress).toEqual({ phase: 'classifying', percent: 50 });
  });

  it('findLatestRunByClassification returns the newest run (createdAt desc) or null', async () => {
    expect(await repo.findLatestRunByClassification(CID)).toBeNull();

    const older = await repo.createRun({
      classificationId: CID,
      keywordAnalysisId: AN,
      snapshotId: SNAP,
      idempotencyKey: 'k-old',
      params: PARAMS,
    });
    // 明確錯開 createdAt（同秒建立時 desc 不穩定）。
    await prisma.customClassifyRun.update({
      where: { id: older.runId },
      data: { createdAt: new Date('2026-01-01T00:00:00Z') },
    });
    const newer = await repo.createRun({
      classificationId: CID,
      keywordAnalysisId: AN,
      snapshotId: SNAP,
      idempotencyKey: 'k-new',
      params: PARAMS,
    });
    await repo.markStatus(newer.runId, 'completed', { keywordCount: 7 });

    const latest = await repo.findLatestRunByClassification(CID);
    expect(latest?.id).toBe(newer.runId);
    expect(latest?.classificationId).toBe(CID);
    expect(latest?.snapshotId).toBe(SNAP);
    expect(latest?.status).toBe('completed');
    expect(latest?.keywordCount).toBe(7);
  });
});
