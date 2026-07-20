import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma';
import { AiSearchRunRepository } from './ai-search-run.repository';

const P2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
  code: 'P2002',
  clientVersion: 'test',
  meta: { target: ['idempotency_key'] },
});

/**
 * Unit coverage for AiSearchRunRepository (T14.6 / FR-41 / AC-41.1) — the idempotency/reset/concurrency edges
 * that Testcontainers can't force deterministically (a real P2002 race): reset-on-terminal, DB `@unique`
 * arbitration on concurrent createRun, and the status/progress/projection helpers.
 */
function build(
  overrides: {
    findUnique?: jest.Mock;
    create?: jest.Mock;
    findUniqueOrThrow?: jest.Mock;
    update?: jest.Mock;
  } = {},
) {
  const aiSearchRun = {
    findUnique: overrides.findUnique ?? jest.fn(() => Promise.resolve(null)),
    create: overrides.create ?? jest.fn(() => Promise.resolve({ id: 'run-1' })),
    findUniqueOrThrow:
      overrides.findUniqueOrThrow ?? jest.fn(() => Promise.resolve({ id: 'run-existing' })),
    update: overrides.update ?? jest.fn(() => Promise.resolve({ id: 'run-1' })),
  };
  const prisma = { aiSearchRun } as unknown as PrismaService;
  return { repo: new AiSearchRunRepository(prisma), aiSearchRun };
}

const INPUT = { ownerId: null, idempotencyKey: 'k-1', params: { schemaVersion: 'ai-search-v1' } };

describe('AiSearchRunRepository (unit, T14.6 / FR-41 / AC-41.1)', () => {
  it('creates a fresh queued run (progress defaults to {}) when the key is unseen', async () => {
    const create = jest.fn<Promise<{ id: string }>, [unknown]>(() =>
      Promise.resolve({ id: 'run-1' }),
    );
    const { repo } = build({ create });
    expect(await repo.createRun(INPUT)).toEqual({ runId: 'run-1', created: true });
    const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ ownerId: null, status: 'queued', progress: {} });
  });

  it('uses a provided progress payload when present (nullish default not applied)', async () => {
    const create = jest.fn<Promise<{ id: string }>, [unknown]>(() =>
      Promise.resolve({ id: 'run-1' }),
    );
    const { repo } = build({ create });
    await repo.createRun({ ...INPUT, progress: { phase: 'pulling', percent: 20 } });
    const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.progress).toEqual({ phase: 'pulling', percent: 20 });
  });

  it('returns the existing run (created:false) on an idempotency fast-path hit', async () => {
    const findUnique = jest.fn(() => Promise.resolve({ id: 'run-existing', status: 'queued' }));
    const create = jest.fn();
    const { repo } = build({ findUnique, create });
    expect(await repo.createRun(INPUT)).toEqual({ runId: 'run-existing', created: false });
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['failed', 'canceled'])(
    'resets a terminal-%s run to queued and returns created:true (re-enqueueable)',
    async (status) => {
      const findUnique = jest.fn(() => Promise.resolve({ id: 'run-x', status }));
      const update = jest.fn<Promise<{ id: string }>, [unknown]>(() =>
        Promise.resolve({ id: 'run-x' }),
      );
      const create = jest.fn();
      const { repo } = build({ findUnique, update, create });
      expect(await repo.createRun(INPUT)).toEqual({ runId: 'run-x', created: true });
      const arg = update.mock.calls[0][0] as { data: { status: string } };
      expect(arg.data.status).toBe('queued');
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('a concurrent P2002 (lost the race) → returns the winner run (created:false), no throw', async () => {
    const create = jest.fn(() => Promise.reject(P2002));
    const findUniqueOrThrow = jest.fn(() => Promise.resolve({ id: 'run-winner' }));
    const { repo, aiSearchRun } = build({ create, findUniqueOrThrow });
    expect(await repo.createRun(INPUT)).toEqual({ runId: 'run-winner', created: false });
    expect(aiSearchRun.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { idempotencyKey: 'k-1' },
    });
  });

  it('a non-P2002 create error is rethrown (not swallowed)', async () => {
    const create = jest.fn(() => Promise.reject(new Error('db exploded')));
    const { repo } = build({ create });
    await expect(repo.createRun(INPUT)).rejects.toThrow('db exploded');
  });

  it('findByIdempotencyKey returns {id,status} or null', async () => {
    const found = build({
      findUnique: jest.fn(() => Promise.resolve({ id: 'run-1', status: 'running' })),
    });
    expect(await found.repo.findByIdempotencyKey('k-1')).toEqual({
      id: 'run-1',
      status: 'running',
    });
    const none = build({ findUnique: jest.fn(() => Promise.resolve(null)) });
    expect(await none.repo.findByIdempotencyKey('nope')).toBeNull();
  });

  it('markStatus updates status + optional captureCount/error', async () => {
    const update = jest.fn(() => Promise.resolve({}));
    const { repo } = build({ update });
    await repo.markStatus('run-1', 'partial', { captureCount: 3 });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { status: 'partial', captureCount: 3, error: undefined },
    });
  });

  it('markStatus defaults the outcome to {} when omitted (running transition)', async () => {
    const update = jest.fn(() => Promise.resolve({}));
    const { repo } = build({ update });
    await repo.markStatus('run-1', 'running');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { status: 'running', captureCount: undefined, error: undefined },
    });
  });

  it('updateProgress writes the progress JSON', async () => {
    const update = jest.fn(() => Promise.resolve({}));
    const { repo } = build({ update });
    await repo.updateProgress('run-1', { phase: 'done', percent: 100 });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { progress: { phase: 'done', percent: 100 } },
    });
  });

  it('findById projects the run view or null', async () => {
    const found = build({
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: 'run-1',
          ownerId: 'owner-A',
          status: 'completed',
          progress: { phase: 'done' },
          captureCount: 4,
        }),
      ),
    });
    expect(await found.repo.findById('run-1')).toEqual({
      id: 'run-1',
      ownerId: 'owner-A',
      status: 'completed',
      progress: { phase: 'done' },
      captureCount: 4,
    });
    const none = build({ findUnique: jest.fn(() => Promise.resolve(null)) });
    expect(await none.repo.findById('run-x')).toBeNull();
  });
});
