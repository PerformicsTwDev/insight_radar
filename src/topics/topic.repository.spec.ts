import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma';
import { TopicRepository } from './topic.repository';

/**
 * TopicRepository.createRun 並發路徑 unit（mock Prisma）：先查未命中 → create 撞 unique（P2002）→ 回既有
 * （NFR-8 並發下 idempotent）；非 P2002 錯上拋。Testcontainers 整合測涵蓋正常往返，此處補難以在真 DB 觸發的競態分支。
 */
function makePrisma(overrides: {
  findUnique: jest.Mock;
  create: jest.Mock;
  findUniqueOrThrow: jest.Mock;
}): PrismaService {
  return { topicRun: overrides } as unknown as PrismaService;
}

const runInput = {
  keywordAnalysisId: 'a',
  snapshotId: 's',
  idempotencyKey: 'k',
  params: {},
};

describe('TopicRepository.createRun concurrent path (T8.9a)', () => {
  it('returns the existing run when create hits a P2002 unique violation', async () => {
    const findUnique = jest.fn().mockResolvedValue(null); // 未先命中 → 嘗試 create
    const create = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const findUniqueOrThrow = jest.fn().mockResolvedValue({ id: 'existing-id' });
    const repo = new TopicRepository(makePrisma({ findUnique, create, findUniqueOrThrow }));

    await expect(repo.createRun(runInput)).resolves.toEqual({
      runId: 'existing-id',
      created: false,
    });
    expect(findUniqueOrThrow).toHaveBeenCalledTimes(1);
  });

  it('re-throws a non-P2002 error', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    const findUniqueOrThrow = jest.fn();
    const repo = new TopicRepository(makePrisma({ findUnique, create, findUniqueOrThrow }));

    await expect(repo.createRun(runInput)).rejects.toThrow('db down');
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
