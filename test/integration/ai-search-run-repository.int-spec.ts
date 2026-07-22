import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ownerWhere } from 'src/common/owner-scope';
import type { PrismaService } from 'src/prisma';
import { AiSearchRunRepository } from 'src/ai-search/ai-search-run.repository';
import { createPrismaTestApp } from '../utils/create-prisma-test-app';

/**
 * TC-77 部分 (T14.6 · FR-41/AC-41.1 · Testcontainers): AiSearchRun 生命週期 + idempotency + reset。
 * 驗 createRun（queued）、idempotencyKey 命中回既有（不重建）、terminal-failed→reset 重跑、
 * markStatus、updateProgress、findById（owner 投影）。
 * T15.8a（#678 G1）：Option A link——keywordAnalysisId 落庫、findAnalysisOwner、owner-scoped 最新 linked run 查詢。
 */
const PARAMS = { schemaVersion: 'ai-search-v1' };
const OWNER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

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
    await prisma.$executeRawUnsafe(
      `DELETE FROM keyword_analyses WHERE owner_id IN ($1::uuid, $2::uuid)`,
      OWNER,
      OTHER,
    );
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

  // --- T15.8a（#678 G1）：Option A additive link → keyword-analysis ---

  it('createRun persists keywordAnalysisId (Option A link); omitted → null (standalone, FR-41 backward compat)', async () => {
    const analysisId = randomUUID();
    const linked = await repo.createRun({
      ownerId: OWNER,
      idempotencyKey: 'k-link',
      params: PARAMS,
      keywordAnalysisId: analysisId,
    });
    expect(
      (await prisma.aiSearchRun.findUniqueOrThrow({ where: { id: linked.runId } }))
        .keywordAnalysisId,
    ).toBe(analysisId);

    const standalone = await repo.createRun({
      ownerId: OWNER,
      idempotencyKey: 'k-standalone',
      params: PARAMS,
    });
    expect(
      (await prisma.aiSearchRun.findUniqueOrThrow({ where: { id: standalone.runId } }))
        .keywordAnalysisId,
    ).toBeNull();
  });

  it('reset (terminal→queued) preserves the original keywordAnalysisId link', async () => {
    const analysisId = randomUUID();
    const { runId } = await repo.createRun({
      ownerId: OWNER,
      idempotencyKey: 'k-reset-link',
      params: PARAMS,
      keywordAnalysisId: analysisId,
    });
    await repo.markStatus(runId, 'failed', { error: 'boom' });
    // Re-submit (no keywordAnalysisId in the reset input) must NOT clear the original link.
    const again = await repo.createRun({
      ownerId: OWNER,
      idempotencyKey: 'k-reset-link',
      params: PARAMS,
    });
    expect(again).toEqual({ runId, created: true });
    const row = await prisma.aiSearchRun.findUniqueOrThrow({ where: { id: runId } });
    expect(row.status).toBe('queued');
    expect(row.keywordAnalysisId).toBe(analysisId); // link preserved through reset
  });

  it('findAnalysisOwner returns the owner projection (null for unknown) — owner-verify lookup (S8)', async () => {
    const analysis = await prisma.keywordAnalysis.create({
      data: {
        status: 'completed',
        seeds: [],
        params: {},
        progress: {},
        idempotencyKey: `idem-${randomUUID()}`,
        ownerId: OWNER,
      },
    });
    expect(await repo.findAnalysisOwner(analysis.id)).toEqual({ ownerId: OWNER });
    expect(await repo.findAnalysisOwner('99999999-9999-9999-9999-999999999999')).toBeNull();
  });

  it('the owner-scoped latest-linked-run query (as getStatus uses) picks the newest run the actor can access', async () => {
    const analysisId = randomUUID();
    const older = await repo.createRun({
      ownerId: OWNER,
      idempotencyKey: 'k-old',
      params: PARAMS,
      keywordAnalysisId: analysisId,
    });
    await repo.markStatus(older.runId, 'failed');
    const newer = await repo.createRun({
      ownerId: OWNER,
      idempotencyKey: 'k-new',
      params: PARAMS,
      keywordAnalysisId: analysisId,
    });
    await repo.markStatus(newer.runId, 'completed');
    // A run linked to the same analysis but owned by another session must NOT surface to OWNER.
    const other = await repo.createRun({
      ownerId: OTHER,
      idempotencyKey: 'k-other',
      params: PARAMS,
      keywordAnalysisId: analysisId,
    });
    await repo.markStatus(other.runId, 'completed');

    const latest = await prisma.aiSearchRun.findFirst({
      where: {
        keywordAnalysisId: analysisId,
        ...ownerWhere({ kind: 'session', id: OWNER, email: 'o@x.io' }),
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });
    expect(latest?.id).toBe(newer.runId); // newest owned run, not OTHER's, not the older failed one
    expect(latest?.status).toBe('completed');
  });
});
