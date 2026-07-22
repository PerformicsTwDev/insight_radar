import type { PrismaService } from '../prisma';
import { AiAnalysisRepository } from './ai-analysis.repository';
import type { AiAnswerRow, AiCitedReferenceRow, AiVisibilityMetricRow } from './ai-analysis.types';

/**
 * TC-78 部分 (T15.5)：AiAnalysisRepository 原子 clean-slate + 落列映射（prisma mock；真 DB round-trip +
 * rollback 原子性由 ai-analysis-job.int-spec 把關）。守：`replaceForJob` 於**單一 `$transaction`** 內三表
 * `deleteMany` + 三表 `createMany`（M15-R8/#689，delete 與 creates 全有或全無）；映射 owner/jobId/schemaVersion；
 * 回三表落列筆數；空 rows 仍 clean-slate（delete + createMany no-op）。
 */

function build() {
  const createAnswers = jest.fn(() => ({ count: 2 }));
  const createCited = jest.fn(() => ({ count: 1 }));
  const createMetrics = jest.fn(() => ({ count: 3 }));
  const delAnswers = jest.fn(() => ({ count: 0 }));
  const delCited = jest.fn(() => ({ count: 0 }));
  const delMetrics = jest.fn(() => ({ count: 0 }));
  // 原子執行語意：array-form `$transaction` await 傳入的每個 PrismaPromise（此處 mock 回值）並回其結果陣列。
  const $transaction = jest.fn((ops: unknown[]) => Promise.all(ops));
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

describe('TC-78: AiAnalysisRepository (T15.5 persistence · M15-R8 atomic)', () => {
  it('replaceForJob：三表 delete + 三表 create 收斂於單一 $transaction（原子 clean-slate）', async () => {
    const { repo, $transaction, createAnswers, createCited, createMetrics } = build();
    await repo.replaceForJob('job-1', 'owner-1', 'v9', {
      answers: [answer],
      cited: [citedRow],
      metrics: [metricRow],
    });
    // 唯一原子邊界：一個 $transaction 呼叫，且其陣列涵蓋 6 個 op（3 delete + 3 create）。
    expect($transaction).toHaveBeenCalledTimes(1);
    const ops = ($transaction.mock.calls[0] as unknown[][])[0];
    expect(ops).toHaveLength(6);
    // createMany 必須在 $transaction 的陣列內建構（非 txn 外分散 await）。
    expect(createAnswers).toHaveBeenCalledTimes(1);
    expect(createCited).toHaveBeenCalledTimes(1);
    expect(createMetrics).toHaveBeenCalledTimes(1);
  });

  it('replaceForJob：clean-slate 三表 deleteMany(where jobId) + 映射 owner/jobId/schemaVersion + 回筆數', async () => {
    const { repo, delAnswers, delCited, delMetrics, createAnswers, createCited, createMetrics } =
      build();
    const counts = await repo.replaceForJob('job-1', 'owner-1', 'v9', {
      answers: [answer],
      cited: [citedRow],
      metrics: [metricRow],
    });
    expect(delAnswers).toHaveBeenCalledWith({ where: { jobId: 'job-1' } });
    expect(delCited).toHaveBeenCalledWith({ where: { jobId: 'job-1' } });
    expect(delMetrics).toHaveBeenCalledWith({ where: { jobId: 'job-1' } });
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
    expect(createCited).toHaveBeenCalledWith({
      data: [expect.objectContaining({ jobId: 'job-1', domain: 'asus.com', mediaType: 'retail' })],
    });
    expect(createMetrics).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ groupKey: 'q', brand: 'ASUS', mentions: 2, exposure: null }),
      ],
    });
    expect(counts).toEqual({ answersCount: 2, citedCount: 1, metricsCount: 3 });
  });

  it('replaceForJob：空 rows → 仍 clean-slate（三表 deleteMany + createMany no-op）於單一 $transaction', async () => {
    const { repo, $transaction, delAnswers, createAnswers } = build();
    await repo.replaceForJob('job-1', null, 'v1', { answers: [], cited: [], metrics: [] });
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(delAnswers).toHaveBeenCalledWith({ where: { jobId: 'job-1' } });
    // 空集：createMany 以 data:[] 進 txn（no-op），仍屬同一原子批（不繞過 clean-slate）。
    expect(createAnswers).toHaveBeenCalledWith({ data: [] });
  });
});
