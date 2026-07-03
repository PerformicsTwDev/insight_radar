import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { embeddingsConfig } from '../config/embeddings.config';
import type { queueConfig } from '../config/queue.config';
import type { topicsConfig } from '../config/topics.config';
import type { PrismaService } from '../prisma';
import type { CreateTopicRunResult, TopicRepository } from './topic.repository';
import { TopicsService } from './topics.service';

interface Deps {
  add: jest.Mock;
  findUnique: jest.Mock;
  deleteRun: jest.Mock;
  createRun: jest.Mock<Promise<CreateTopicRunResult>, [unknown]>;
  findLatestRunByAnalysis: jest.Mock;
  loadClusters: jest.Mock;
  loadAssignments: jest.Mock;
  loadKeywordTexts: jest.Mock;
}

function makeService(): { service: TopicsService; deps: Deps } {
  const deps: Deps = {
    add: jest.fn().mockResolvedValue(undefined),
    findUnique: jest.fn(),
    deleteRun: jest.fn().mockResolvedValue(undefined),
    createRun: jest.fn<Promise<CreateTopicRunResult>, [unknown]>(),
    findLatestRunByAnalysis: jest.fn(),
    loadClusters: jest.fn().mockResolvedValue([]),
    loadAssignments: jest.fn().mockResolvedValue([]),
    loadKeywordTexts: jest.fn().mockResolvedValue(new Map()),
  };
  const queue = { add: deps.add } as unknown as Queue;
  const prisma = {
    keywordAnalysis: { findUnique: deps.findUnique },
    topicRun: { delete: deps.deleteRun },
  } as unknown as PrismaService;
  const repo = {
    createRun: deps.createRun,
    findLatestRunByAnalysis: deps.findLatestRunByAnalysis,
    loadClusters: deps.loadClusters,
    loadAssignments: deps.loadAssignments,
    loadKeywordTexts: deps.loadKeywordTexts,
  } as unknown as TopicRepository;
  const topics = { promptVersion: 'v1', schemaVersion: 'v1' } as ConfigType<typeof topicsConfig>;
  const embeddings = {
    model: 'gemini-embedding-001',
    schemaVersion: 'v1',
  } as ConfigType<typeof embeddingsConfig>;
  const queueCfg = {
    jobAttempts: 5,
    jobBackoffMs: 3000,
    jobBackoffJitter: 0.2,
  } as ConfigType<typeof queueConfig>;
  const service = new TopicsService(queue, prisma, repo, topics, embeddings, queueCfg);
  return { service, deps };
}

function analysis(status: string, hasSnapshot = status === 'completed' || status === 'partial') {
  return {
    id: 'a-1',
    status,
    params: { geo: 'US', language: 'en' },
    resultSnapshot: hasSnapshot ? { id: 'snap-1', checksum: 'chk', keywordCount: 3 } : null,
  };
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
  const error = (await promise.catch((e: unknown) => e)) as HttpException;
  return error.getStatus();
}

describe('TopicsService.create (T8.10 / TC-48)', () => {
  it('404 when the analysis does not exist', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue(null);

    await expect(service.create('missing', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('425 Too Early when the analysis is still queued/running', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue(analysis('running'));

    expect(await statusOf(service.create('a-1', {}))).toBe(425); // Too Early
    expect(deps.createRun).not.toHaveBeenCalled();
  });

  it('409 Conflict when the analysis failed/canceled (no usable snapshot)', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue(analysis('failed'));

    await expect(service.create('a-1', {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('enqueues and returns topicJobId for a completed analysis (202 path)', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue(analysis('completed'));
    deps.createRun.mockResolvedValue({ runId: 'run-1', created: true });

    const result = await service.create('a-1', { serpEnabled: true, topK: 15 });

    expect(result).toEqual({ topicJobId: 'run-1' });
    // createRun 帶 idempotencyKey + params（含版本 + serpEnabled + topK）。
    const createArg = deps.createRun.mock.calls[0][0] as {
      idempotencyKey: string;
      params: Record<string, unknown>;
    };
    expect(createArg.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(createArg.params).toMatchObject({ serpEnabled: true, topK: 15, promptVersion: 'v1' });
    // 入列：jobId=runId、payload 帶 geo/language。
    expect(deps.add).toHaveBeenCalledTimes(1);
    const [, payload, opts] = deps.add.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { jobId: string },
    ];
    expect(opts.jobId).toBe('run-1');
    expect(payload).toMatchObject({
      runId: 'run-1',
      analysisId: 'a-1',
      snapshotId: 'snap-1',
      geo: 'US',
      language: 'en',
    });
  });

  it('derives distinct idempotency keys for distinct analyses with identical checksum + params (M8-R7 wiring · M8-R13)', async () => {
    const { service, deps } = makeService();
    deps.createRun.mockResolvedValue({ runId: 'run-x', created: false });
    // 兩個 analysisId 不同、但 snapshot.checksum + params 位元完全相同的分析。
    const mkAnalysis = (id: string) => ({
      id,
      status: 'completed',
      params: { geo: 'US', language: 'en' },
      resultSnapshot: { id: `snap-${id}`, checksum: 'IDENTICAL', keywordCount: 3 },
    });

    deps.findUnique.mockResolvedValueOnce(mkAnalysis('analysis-A'));
    await service.create('analysis-A', { topK: 20 });
    deps.findUnique.mockResolvedValueOnce(mkAnalysis('analysis-B'));
    await service.create('analysis-B', { topK: 20 });

    const keyA = (deps.createRun.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey;
    const keyB = (deps.createRun.mock.calls[1][0] as { idempotencyKey: string }).idempotencyKey;
    // 綁 analysisId → 內容位元相同的不同分析必得不同 key（否則後者複用前者的 run、GET 永久 404，M8-R7）。
    // 若把 analysisId 從 key 組成中拿掉（回退 M8-R7），兩 key 相同 → 本測試轉紅。
    expect(keyA).toMatch(/^[0-9a-f]{64}$/);
    expect(keyA).not.toBe(keyB);
  });

  it('does not re-enqueue on idempotency hit (created=false)', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue(analysis('completed'));
    deps.createRun.mockResolvedValue({ runId: 'run-existing', created: false });

    const result = await service.create('a-1', {});

    expect(result).toEqual({ topicJobId: 'run-existing' });
    expect(deps.add).not.toHaveBeenCalled(); // 命中既有 → 不重複入列
  });

  it('accepts a partial-snapshot analysis as ready', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue(analysis('partial'));
    deps.createRun.mockResolvedValue({ runId: 'run-2', created: true });

    await expect(service.create('a-1', {})).resolves.toEqual({ topicJobId: 'run-2' });
  });

  it('compensates by deleting the run when enqueue fails', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue(analysis('completed'));
    deps.createRun.mockResolvedValue({ runId: 'run-3', created: true });
    deps.add.mockRejectedValue(new Error('redis down'));

    await expect(service.create('a-1', {})).rejects.toThrow('redis down');
    expect(deps.deleteRun).toHaveBeenCalledWith({ where: { id: 'run-3' } });
  });
});

describe('TopicsService.getTopics (T8.10b / TC-49)', () => {
  it('404 when the analysis has no topic run', async () => {
    const { service, deps } = makeService();
    deps.findLatestRunByAnalysis.mockResolvedValue(null);

    await expect(service.getTopics('a-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assembles the response from the latest run + clusters + assignments', async () => {
    const { service, deps } = makeService();
    deps.findLatestRunByAnalysis.mockResolvedValue({
      id: 'run-1',
      snapshotId: 'snap-1',
      status: 'completed',
      progress: { phase: 'persist', percent: 100 },
      clusterCount: 1,
      noiseCount: 0,
    });
    deps.loadClusters.mockResolvedValue([
      {
        clusterId: 'c0',
        clusterLabel: 0,
        topicName: 'Coffee',
        parentTopic: 'Beverages',
        intentLabel: 'commercial',
        topicType: 'head',
        reason: 'r',
        clusterVolume: 100n,
        keywordCount: 1,
        confidence: 0.9,
        representativeKeywords: [],
      },
    ]);
    deps.loadAssignments.mockResolvedValue([
      { normalizedText: 'a', clusterId: 'c0', confidence: 0.9, isNoise: false },
    ]);
    deps.loadKeywordTexts.mockResolvedValue(new Map([['a', 'Keyword A']]));

    const res = await service.getTopics('a-1');

    expect(res.status).toBe('completed');
    expect(res.meta.runId).toBe('run-1');
    expect(res.clusters[0].topicName).toBe('Coffee');
    expect(res.keywords[0]).toMatchObject({
      text: 'Keyword A',
      intentLabel: 'commercial',
      isNoise: false,
    });
    // 讀取以 run.id / run.snapshotId 為 key。
    expect(deps.loadKeywordTexts).toHaveBeenCalledWith('snap-1');
  });

  it('getRunRef returns {runId,status} for the latest run, or null', async () => {
    const { service, deps } = makeService();
    deps.findLatestRunByAnalysis.mockResolvedValueOnce({
      id: 'run-9',
      snapshotId: 'snap-9',
      status: 'running',
      progress: {},
      clusterCount: null,
      noiseCount: null,
    });
    expect(await service.getRunRef('a-1')).toEqual({ runId: 'run-9', status: 'running' });

    deps.findLatestRunByAnalysis.mockResolvedValueOnce(null);
    expect(await service.getRunRef('a-2')).toBeNull();
  });
});
