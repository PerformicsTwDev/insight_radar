import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma';
import { JourneyRunRepository } from './journey-run.repository';

const P2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
  code: 'P2002',
  clientVersion: 'test',
  meta: { target: ['idempotency_key'] },
});

/**
 * Unit coverage for the concurrency edge of `createRun` that integration can't force (a real P2002
 * race): the DB `@unique(idempotency_key)` arbitrates → the loser catches P2002 and returns the winner's
 * run (`created:false`); any other error rethrows (NFR-8 idempotency under concurrency).
 */
function build(
  overrides: { create?: jest.Mock; findUnique?: jest.Mock; findUniqueOrThrow?: jest.Mock } = {},
) {
  const journeyRun = {
    findUnique: overrides.findUnique ?? jest.fn(() => Promise.resolve(null)),
    create: overrides.create ?? jest.fn(() => Promise.resolve({ id: 'run-1' })),
    findUniqueOrThrow:
      overrides.findUniqueOrThrow ?? jest.fn(() => Promise.resolve({ id: 'run-existing' })),
  };
  const prisma = { journeyRun } as unknown as PrismaService;
  return { repo: new JourneyRunRepository(prisma), journeyRun };
}

const INPUT = {
  keywordAnalysisId: 'an-1',
  snapshotId: 'snap-1',
  idempotencyKey: 'k-1',
  params: { schemaVersion: 'v1', deployment: 'd' },
};

describe('JourneyRunRepository.createRun concurrency (T12.6 / AC-33.6)', () => {
  it('creates a fresh run when the key is unseen', async () => {
    const { repo } = build();
    expect(await repo.createRun(INPUT)).toEqual({ runId: 'run-1', created: true });
  });

  it('a concurrent P2002 (lost the race) → returns the winner run (created:false), no throw', async () => {
    const create = jest.fn(() => Promise.reject(P2002));
    const findUniqueOrThrow = jest.fn(() => Promise.resolve({ id: 'run-winner' }));
    const { repo, journeyRun } = build({ create, findUniqueOrThrow });
    expect(await repo.createRun(INPUT)).toEqual({ runId: 'run-winner', created: false });
    expect(journeyRun.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { idempotencyKey: 'k-1' },
    });
  });

  it('a non-P2002 create error is rethrown (not swallowed)', async () => {
    const create = jest.fn(() => Promise.reject(new Error('db exploded')));
    const { repo } = build({ create });
    await expect(repo.createRun(INPUT)).rejects.toThrow('db exploded');
  });
});
