import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from 'src/prisma';
import { AiSearchRunRepository } from 'src/ai-search/ai-search-run.repository';
import { createPrismaTestApp } from '../utils/create-prisma-test-app';

/**
 * TC-77 部分 (T14.6 · FR-41/AC-41.1 · Testcontainers): AiSearchRun 生命週期 + idempotency + reset。
 * 驗 createRun（queued）、idempotencyKey 命中回既有（不重建）、terminal-failed→reset 重跑、findByIdempotencyKey、
 * markStatus、updateProgress、findById（owner 投影）。
 */
const PARAMS = { schemaVersion: 'ai-search-v1' };

describe('AiSearchRunRepository (integration · Testcontainers, TC-77 部分)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repo: AiSearchRunRepository;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
    repo = new AiSearchRunRepository(prisma);
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM ai_search_runs');
  });

  it('createRun creates a queued run; a second call with the same idempotencyKey returns the existing run', async () => {
    const first = await repo.createRun({ ownerId: null, idempotencyKey: 'k-1', params: PARAMS });
    expect(first.created).toBe(true);

    const row = await prisma.aiSearchRun.findUniqueOrThrow({ where: { id: first.runId } });
    expect(row.status).toBe('queued');
    expect(row.ownerId).toBeNull();

    const second = await repo.createRun({ ownerId: null, idempotencyKey: 'k-1', params: PARAMS });
    expect(second).toEqual({ runId: first.runId, created: false });
    expect(await prisma.aiSearchRun.count()).toBe(1);
  });

  it('persists ownerId (owner-scoped run)', async () => {
    const owner = '11111111-1111-1111-1111-111111111111';
    const { runId } = await repo.createRun({
      ownerId: owner,
      idempotencyKey: 'k-own',
      params: PARAMS,
    });
    const row = await prisma.aiSearchRun.findUniqueOrThrow({ where: { id: runId } });
    expect(row.ownerId).toBe(owner);
  });

  it('resets a terminal-failed run to queued on the same idempotencyKey (created=true, re-runnable)', async () => {
    const { runId } = await repo.createRun({
      ownerId: null,
      idempotencyKey: 'k-r',
      params: PARAMS,
    });
    await repo.markStatus(runId, 'failed', { error: 'boom', captureCount: 3 });

    const again = await repo.createRun({ ownerId: null, idempotencyKey: 'k-r', params: PARAMS });
    expect(again).toEqual({ runId, created: true }); // same id, re-runnable
    const row = await prisma.aiSearchRun.findUniqueOrThrow({ where: { id: runId } });
    expect(row.status).toBe('queued');
    expect(row.error).toBeNull();
    expect(row.captureCount).toBeNull();
  });

  it('resets a terminal-partial run to queued on the same idempotencyKey (created=true, async re-collect) [7] M14-R3/#579', async () => {
    // partial = a channel had no capture at job time; extension captures arrive async, so a re-submit
    // must re-run (unlike journey/custom-classify where partial is a stable terminal).
    const { runId } = await repo.createRun({
      ownerId: null,
      idempotencyKey: 'k-partial',
      params: PARAMS,
    });
    await repo.markStatus(runId, 'partial', { captureCount: 1 });

    const again = await repo.createRun({
      ownerId: null,
      idempotencyKey: 'k-partial',
      params: PARAMS,
    });
    expect(again).toEqual({ runId, created: true });
    const row = await prisma.aiSearchRun.findUniqueOrThrow({ where: { id: runId } });
    expect(row.status).toBe('queued');
    expect(row.captureCount).toBeNull();
  });

  it('concurrent re-submits of a terminal run reset it exactly once (atomic conditional updateMany) [6] M14-R3/#579', async () => {
    const { runId } = await repo.createRun({
      ownerId: null,
      idempotencyKey: 'k-race',
      params: PARAMS,
    });
    await repo.markStatus(runId, 'failed', { error: 'boom' });

    // Two concurrent createRun calls on the same terminal key: the atomic conditional reset must let
    // exactly one win the terminal→queued transition (created=true) so the service enqueues once.
    const [a, b] = await Promise.all([
      repo.createRun({ ownerId: null, idempotencyKey: 'k-race', params: PARAMS }),
      repo.createRun({ ownerId: null, idempotencyKey: 'k-race', params: PARAMS }),
    ]);
    expect(a.runId).toBe(runId);
    expect(b.runId).toBe(runId);
    const winners = [a.created, b.created].filter(Boolean).length;
    expect(winners).toBe(1); // exactly one re-enqueue, no double
    const row = await prisma.aiSearchRun.findUniqueOrThrow({ where: { id: runId } });
    expect(row.status).toBe('queued');
    expect(await prisma.aiSearchRun.count()).toBe(1);
  });

  it('findByIdempotencyKey returns {id,status} or null', async () => {
    const { runId } = await repo.createRun({
      ownerId: null,
      idempotencyKey: 'k-2',
      params: PARAMS,
    });
    expect(await repo.findByIdempotencyKey('k-2')).toEqual({ id: runId, status: 'queued' });
    expect(await repo.findByIdempotencyKey('nope')).toBeNull();
  });

  it('markStatus updates status + captureCount + error (undefined fields untouched)', async () => {
    const { runId } = await repo.createRun({
      ownerId: null,
      idempotencyKey: 'k-3',
      params: PARAMS,
    });
    await repo.markStatus(runId, 'running');
    expect((await prisma.aiSearchRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe(
      'running',
    );

    await repo.markStatus(runId, 'partial', { captureCount: 7 });
    const done = await prisma.aiSearchRun.findUniqueOrThrow({ where: { id: runId } });
    expect(done.status).toBe('partial');
    expect(done.captureCount).toBe(7);

    await repo.markStatus(runId, 'failed', { error: 'x' });
    const failed = await prisma.aiSearchRun.findUniqueOrThrow({ where: { id: runId } });
    expect(failed.error).toBe('x');
    expect(failed.captureCount).toBe(7); // undefined captureCount → not overwritten
  });

  it('updateProgress persists the progress JSON; findById projects owner + captureCount', async () => {
    const { runId } = await repo.createRun({
      ownerId: null,
      idempotencyKey: 'k-4',
      params: PARAMS,
    });
    await repo.updateProgress(runId, { phase: 'collecting', percent: 60 });
    const view = await repo.findById(runId);
    expect(view).toMatchObject({
      id: runId,
      ownerId: null,
      status: 'queued',
      progress: { phase: 'collecting', percent: 60 },
      captureCount: null,
    });
    expect(await repo.findById('99999999-9999-9999-9999-999999999999')).toBeNull();
  });
});
