import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma';
import { CustomClassifyRunRepository } from './custom-classify-run.repository';

const P2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
  code: 'P2002',
  clientVersion: 'test',
  meta: { target: ['idempotency_key'] },
});

/**
 * Unit coverage for the concurrency edge of `createRun` that integration can't force (a real P2002
 * race): the DB `@unique(idempotency_key)` arbitrates → the loser catches P2002 and returns the winner's
 * run (`created:false`); any other error rethrows (NFR-8 idempotency under concurrency, T12.8/AC-34.2).
 */
function build(
  overrides: {
    create?: jest.Mock;
    findUnique?: jest.Mock;
    findUniqueOrThrow?: jest.Mock;
    findFirst?: jest.Mock;
    update?: jest.Mock;
  } = {},
) {
  const customClassifyRun = {
    findUnique: overrides.findUnique ?? jest.fn(() => Promise.resolve(null)),
    create: overrides.create ?? jest.fn(() => Promise.resolve({ id: 'run-1' })),
    findUniqueOrThrow:
      overrides.findUniqueOrThrow ?? jest.fn(() => Promise.resolve({ id: 'run-existing' })),
    findFirst: overrides.findFirst ?? jest.fn(() => Promise.resolve(null)),
    update: overrides.update ?? jest.fn(() => Promise.resolve({ id: 'run-existing' })),
  };
  const prisma = { customClassifyRun } as unknown as PrismaService;
  return { repo: new CustomClassifyRunRepository(prisma), customClassifyRun };
}

const INPUT = {
  classificationId: 'cid-1',
  keywordAnalysisId: 'an-1',
  snapshotId: 'snap-1',
  idempotencyKey: 'k-1',
  params: { schemaVersion: 'v1', deployment: 'd', labelsHash: 'lh' },
};

describe('CustomClassifyRunRepository (T12.8 / FR-34 / AC-34.2)', () => {
  describe('createRun concurrency', () => {
    it('resets a terminal-failed run to queued and returns created:true (M12-R1: re-enqueueable)', async () => {
      const findUnique = jest.fn(() => Promise.resolve({ id: 'run-failed', status: 'failed' }));
      const update = jest.fn<Promise<{ id: string }>, [unknown]>(() =>
        Promise.resolve({ id: 'run-failed' }),
      );
      const create = jest.fn();
      const { repo } = build({ findUnique, update, create });
      expect(await repo.createRun(INPUT)).toEqual({ runId: 'run-failed', created: true });
      const arg = update.mock.calls[0][0] as { where: { id: string }; data: { status: string } };
      expect(arg.where.id).toBe('run-failed');
      expect(arg.data.status).toBe('queued');
      expect(create).not.toHaveBeenCalled(); // reuse same runId, no new row
    });

    it('does NOT reset a completed run (idempotent, created:false)', async () => {
      const findUnique = jest.fn(() => Promise.resolve({ id: 'run-done', status: 'completed' }));
      const update = jest.fn();
      const { repo } = build({ findUnique, update });
      expect(await repo.createRun(INPUT)).toEqual({ runId: 'run-done', created: false });
      expect(update).not.toHaveBeenCalled();
    });

    it('creates a fresh run when the key is unseen', async () => {
      const { repo } = build();
      expect(await repo.createRun(INPUT)).toEqual({ runId: 'run-1', created: true });
    });

    it('returns the existing run (created:false) when the key was already seen (idempotency fast path)', async () => {
      const findUnique = jest.fn(() => Promise.resolve({ id: 'run-existing' }));
      const create = jest.fn();
      const { repo } = build({ findUnique, create });
      expect(await repo.createRun(INPUT)).toEqual({ runId: 'run-existing', created: false });
      expect(create).not.toHaveBeenCalled();
    });

    it('a concurrent P2002 (lost the race) → returns the winner run (created:false), no throw', async () => {
      const create = jest.fn(() => Promise.reject(P2002));
      const findUniqueOrThrow = jest.fn(() => Promise.resolve({ id: 'run-winner' }));
      const { repo, customClassifyRun } = build({ create, findUniqueOrThrow });
      expect(await repo.createRun(INPUT)).toEqual({ runId: 'run-winner', created: false });
      expect(customClassifyRun.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { idempotencyKey: 'k-1' },
      });
    });

    it('a non-P2002 create error is rethrown (not swallowed)', async () => {
      const create = jest.fn(() => Promise.reject(new Error('db exploded')));
      const { repo } = build({ create });
      await expect(repo.createRun(INPUT)).rejects.toThrow('db exploded');
    });
  });

  describe('findLatestRunByClassification', () => {
    it('projects the newest run', async () => {
      const findFirst = jest.fn(() =>
        Promise.resolve({
          id: 'run-1',
          classificationId: 'cid-1',
          snapshotId: 'snap-1',
          status: 'completed',
          progress: { phase: 'done' },
          keywordCount: 5,
          error: null,
          params: {},
          idempotencyKey: 'k',
          createdAt: new Date('2026-07-18T00:00:00Z'),
        }),
      );
      const { repo } = build({ findFirst });
      expect(await repo.findLatestRunByClassification('cid-1')).toEqual({
        id: 'run-1',
        classificationId: 'cid-1',
        snapshotId: 'snap-1',
        status: 'completed',
        progress: { phase: 'done' },
        keywordCount: 5,
      });
    });

    it('returns null when there is no run', async () => {
      const { repo } = build({ findFirst: jest.fn(() => Promise.resolve(null)) });
      expect(await repo.findLatestRunByClassification('cid-1')).toBeNull();
    });
  });

  describe('findInProgressRunByClassification (M12-R8 concurrent guard)', () => {
    it('queries queued/running runs for the cid (latest first) and returns id + idempotencyKey', async () => {
      const findFirst = jest.fn(() => Promise.resolve({ id: 'run-x', idempotencyKey: 'k-x' }));
      const { repo, customClassifyRun } = build({ findFirst });
      expect(await repo.findInProgressRunByClassification('cid-1')).toEqual({
        id: 'run-x',
        idempotencyKey: 'k-x',
      });
      expect(customClassifyRun.findFirst).toHaveBeenCalledWith({
        where: { classificationId: 'cid-1', status: { in: ['queued', 'running'] } },
        select: { id: true, idempotencyKey: true },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('returns null when the cid has no in-progress run', async () => {
      const { repo } = build({ findFirst: jest.fn(() => Promise.resolve(null)) });
      expect(await repo.findInProgressRunByClassification('cid-1')).toBeNull();
    });
  });

  describe('exists (M12-#512 cooperative-cancellation probe)', () => {
    it('true when the run row is present', async () => {
      const { repo, customClassifyRun } = build({
        findUnique: jest.fn(() => Promise.resolve({ id: 'run-1' })),
      });
      expect(await repo.exists('run-1')).toBe(true);
      expect(customClassifyRun.findUnique).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        select: { id: true },
      });
    });

    it('false when the run row is gone (deleted mid-flight)', async () => {
      const { repo } = build({ findUnique: jest.fn(() => Promise.resolve(null)) });
      expect(await repo.exists('run-x')).toBe(false);
    });
  });
});
