import type { PrismaService } from '../prisma';
import { AiAnalysisRepository } from './ai-analysis.repository';
import type { AiAnswerRow, AiCitedReferenceRow, AiVisibilityMetricRow } from './ai-analysis.types';

/**
 * TC-78 部分 (T15.5)：AiAnalysisRepository 空集守衛 + 落列映射（prisma mock；真 DB round-trip 由
 * ai-analysis-job.int-spec 把關）。守：空 rows → 回 0 不呼叫 createMany；非空 → createMany 帶 owner/jobId/
 * schemaVersion；deleteByJobId 三表 clean-slate（$transaction）。
 */

function build() {
  const createAnswers = jest.fn(() => Promise.resolve({ count: 2 }));
  const createCited = jest.fn(() => Promise.resolve({ count: 1 }));
  const createMetrics = jest.fn(() => Promise.resolve({ count: 3 }));
  const delAnswers = jest.fn();
  const delCited = jest.fn();
  const delMetrics = jest.fn();
  const $transaction = jest.fn(() => Promise.resolve([]));
  const prisma = {
    $transaction,
    aiAnswer: { deleteMany: delAnswers, createMany: createAnswers },
    aiCitedReference: { deleteMany: delCited, createMany: createCited },
    aiVisibilityMetric: { deleteMany: delMetrics, createMany: createMetrics },
  } as unknown as PrismaService;
  return {
    repo: new AiAnalysisRepository(prisma),
    createAnswers,
    createCited,
    createMetrics,
    delAnswers,
    delCited,
    delMetrics,
    $transaction,
  };
}

const answer: AiAnswerRow = {
  channel: 'chatGpt',
  query: 'q',
  answerText: 'a',
  brands: ['ASUS'],
  positive: 1,
  negative: 0,
};
const citedRow: AiCitedReferenceRow = {
  channel: 'chatGpt',
  query: 'q',
  link: 'https://asus.com',
  domain: 'asus.com',
  title: null,
  mediaType: 'retail',
};
const metricRow: AiVisibilityMetricRow = {
  channel: 'chatGpt',
  dimension: 'keyword',
  groupKey: 'q',
  brand: 'ASUS',
  mentions: 2,
  shareOfVoice: 1,
  citations: 0,
  exposure: null,
};

describe('TC-78: AiAnalysisRepository (T15.5 persistence)', () => {
  it('deleteByJobId clean-slates all three tables in one $transaction', async () => {
    const { repo, $transaction, delAnswers, delCited, delMetrics } = build();
    await repo.deleteByJobId('job-1');
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(delAnswers).toHaveBeenCalledWith({ where: { jobId: 'job-1' } });
    expect(delCited).toHaveBeenCalledWith({ where: { jobId: 'job-1' } });
    expect(delMetrics).toHaveBeenCalledWith({ where: { jobId: 'job-1' } });
  });

  describe('empty rows → 0, no createMany (skip DB round-trip)', () => {
    it('persistAnswers', async () => {
      const { repo, createAnswers } = build();
      expect(await repo.persistAnswers('j', null, 'v1', [])).toBe(0);
      expect(createAnswers).not.toHaveBeenCalled();
    });
    it('persistCitedReferences', async () => {
      const { repo, createCited } = build();
      expect(await repo.persistCitedReferences('j', null, 'v1', [])).toBe(0);
      expect(createCited).not.toHaveBeenCalled();
    });
    it('persistMetrics', async () => {
      const { repo, createMetrics } = build();
      expect(await repo.persistMetrics('j', null, 'v1', [])).toBe(0);
      expect(createMetrics).not.toHaveBeenCalled();
    });
  });

  it('persistAnswers maps rows with owner/jobId/schemaVersion and returns count', async () => {
    const { repo, createAnswers } = build();
    expect(await repo.persistAnswers('job-1', 'owner-1', 'v9', [answer])).toBe(2);
    expect(createAnswers).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          ownerId: 'owner-1',
          jobId: 'job-1',
          schemaVersion: 'v9',
          brands: ['ASUS'],
        }),
      ],
    });
  });

  it('persistCitedReferences maps rows and returns count', async () => {
    const { repo, createCited } = build();
    expect(await repo.persistCitedReferences('job-1', null, 'v9', [citedRow])).toBe(1);
    expect(createCited).toHaveBeenCalledWith({
      data: [expect.objectContaining({ jobId: 'job-1', domain: 'asus.com', mediaType: 'retail' })],
    });
  });

  it('persistMetrics maps rows (group->groupKey, null sov/exposure) and returns count', async () => {
    const { repo, createMetrics } = build();
    expect(await repo.persistMetrics('job-1', null, 'v9', [metricRow])).toBe(3);
    expect(createMetrics).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ groupKey: 'q', brand: 'ASUS', mentions: 2, exposure: null }),
      ],
    });
  });
});
