import { Prisma } from '@prisma/client';
import type { ConfigType } from '@nestjs/config';
import type { Job } from 'bullmq';
import type { PinoLogger } from 'nestjs-pino';
import type { ClusteringProvider } from '../clustering/clustering-provider.port';
import { ClusteringUnavailableError } from '../clustering/clustering.errors';
import type { ClusterResult } from '../clustering/clustering.types';
import type { topicsConfig } from '../config/topics.config';
import type { EmbeddingService } from '../embeddings/embedding.service';
import type { PrismaService } from '../prisma';
import type { SerpProvider } from '../serp/serp-provider.port';
import { TopicClusterProcessor } from './topic-cluster.processor';
import type { ClusterNaming } from './topic-naming.postprocess';
import type { TopicNamingService } from './topic-naming.service';
import type { TopicJobPayload } from './topic-job.types';
import type { TopicRepository } from './topic.repository';

type EmbedItemLike = { geo: string; language: string; normalizedText: string; serp?: unknown };
type ProgressArgs = [string, { phase: string; percent: number }];

interface Deps {
  findMany: jest.Mock;
  fetch: jest.Mock;
  embed: jest.Mock<Promise<number[][]>, [EmbedItemLike[]]>;
  cluster: jest.Mock;
  nameClusters: jest.Mock;
  markStatus: jest.Mock;
  updateProgress: jest.Mock<Promise<void>, ProgressArgs>;
  persist: jest.Mock;
}

function makeProcessor(metricsInfo?: jest.Mock): { processor: TopicClusterProcessor; deps: Deps } {
  const deps: Deps = {
    findMany: jest.fn(),
    fetch: jest.fn(),
    embed: jest.fn<Promise<number[][]>, [EmbedItemLike[]]>(),
    cluster: jest.fn(),
    nameClusters: jest.fn(),
    markStatus: jest.fn().mockResolvedValue(undefined),
    updateProgress: jest.fn<Promise<void>, ProgressArgs>().mockResolvedValue(undefined),
    persist: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = { snapshotRow: { findMany: deps.findMany } } as unknown as PrismaService;
  const serp = { fetch: deps.fetch } as unknown as SerpProvider;
  const embeddings = { embed: deps.embed } as unknown as EmbeddingService;
  const clustering = { cluster: deps.cluster } as unknown as ClusteringProvider;
  const naming = { nameClusters: deps.nameClusters } as unknown as TopicNamingService;
  const repo = {
    markStatus: deps.markStatus,
    updateProgress: deps.updateProgress,
    persist: deps.persist,
  } as unknown as TopicRepository;
  const config = { queueConcurrency: 3 } as ConfigType<typeof topicsConfig>;
  const metricsLog = metricsInfo ? ({ info: metricsInfo } as unknown as PinoLogger) : undefined;
  const processor = new TopicClusterProcessor(
    prisma,
    serp,
    embeddings,
    clustering,
    naming,
    repo,
    config,
    metricsLog,
  );
  return { processor, deps };
}

function snapshotRow(normalizedText: string, avgMonthlySearches: number | null = 100) {
  return { data: { normalizedText, text: normalizedText, avgMonthlySearches }, rowIndex: 0 };
}

function clusterResult(labels: number[], probabilities: number[]): ClusterResult {
  const ids = [...new Set(labels.filter((l) => l >= 0))];
  return {
    labels,
    probabilities,
    cluster_ids: ids,
    exemplar_indices: ids.map(() => [0]),
    meta: { n_clusters: ids.length, n_noise: 0, reduced_dim: 10, seed: 42, lib_versions: {} },
  };
}

function naming(label: number, degraded = false): ClusterNaming {
  return {
    clusterLabel: label,
    topicName: `T${label}`,
    parentTopic: 'P',
    intentLabel: 'commercial',
    topicType: 'head',
    reason: 'r',
    degraded,
  };
}

function job(
  params: Partial<TopicJobPayload['params']> = {},
  jobUpdateProgress: jest.Mock = jest.fn().mockResolvedValue(undefined),
): Job<TopicJobPayload> {
  return {
    data: {
      runId: 'run-1',
      analysisId: 'a-1',
      snapshotId: 'snap-1',
      geo: 'US',
      language: 'en',
      params: {
        serpEnabled: false,
        embeddingModel: 'gemini-embedding-001',
        embeddingSchemaVersion: 'v1',
        promptVersion: 'v1',
        schemaVersion: 'v1',
        ...params,
      },
    },
    updateProgress: jobUpdateProgress, // BullMQ QueueEvents → SSE（M8-R8）
  } as unknown as Job<TopicJobPayload>;
}

describe('TopicClusterProcessor (T8.9b / TC-46 · TC-51)', () => {
  it('runs the full pipeline and completes (running → completed, progress per phase)', async () => {
    const { processor, deps } = makeProcessor();
    deps.findMany.mockResolvedValue([snapshotRow('a'), snapshotRow('b'), snapshotRow('c')]);
    deps.embed.mockResolvedValue([
      [1, 0],
      [1, 0],
      [0, 1],
    ]);
    deps.cluster.mockResolvedValue(clusterResult([0, 0, 1], [0.9, 0.8, 0.95]));
    deps.nameClusters.mockResolvedValue([naming(0), naming(1)]);

    const result = await processor.process(job());

    expect(result).toEqual({ status: 'completed', clusterCount: 2, noiseCount: 0 });
    expect(deps.markStatus).toHaveBeenNthCalledWith(1, 'run-1', 'running'); // 先標 running
    expect(deps.markStatus).toHaveBeenLastCalledWith('run-1', 'completed', {
      clusterCount: 2,
      noiseCount: 0,
    });
    expect(deps.persist).toHaveBeenCalledTimes(1);
    expect(deps.fetch).not.toHaveBeenCalled(); // serpEnabled=false
    const phases = deps.updateProgress.mock.calls.map((c) => c[1].phase);
    expect(phases).toEqual(['load', 'serp', 'embed', 'cluster', 'represent', 'name', 'persist']);
  });

  it('publishes phase progress to job.updateProgress for the SSE stream (M8-R8)', async () => {
    const { processor, deps } = makeProcessor();
    deps.findMany.mockResolvedValue([snapshotRow('a'), snapshotRow('b'), snapshotRow('c')]);
    deps.embed.mockResolvedValue([
      [1, 0],
      [1, 0],
      [0, 1],
    ]);
    deps.cluster.mockResolvedValue(clusterResult([0, 0, 1], [0.9, 0.8, 0.95]));
    deps.nameClusters.mockResolvedValue([naming(0), naming(1)]);
    const jobUpdateProgress = jest.fn<Promise<void>, [{ phase: string; percent: number }]>();
    jobUpdateProgress.mockResolvedValue(undefined);

    await processor.process(job({}, jobUpdateProgress));

    // BullMQ QueueEvents 'progress' 由 job.updateProgress 觸發 → topics @Sse 串流才收得到進度。
    const phases = jobUpdateProgress.mock.calls.map((c) => c[0].phase);
    expect(phases).toEqual(['load', 'serp', 'embed', 'cluster', 'represent', 'name', 'persist']);
  });

  it('does NOT downgrade a successful run to partial when a Redis progress-publish blips mid-pipeline (M8-R12)', async () => {
    const { processor, deps } = makeProcessor();
    deps.findMany.mockResolvedValue([snapshotRow('a'), snapshotRow('b'), snapshotRow('c')]);
    deps.embed.mockResolvedValue([
      [1, 0],
      [1, 0],
      [0, 1],
    ]);
    deps.cluster.mockResolvedValue(clusterResult([0, 0, 1], [0.9, 0.8, 0.95]));
    deps.nameClusters.mockResolvedValue([naming(0), naming(1)]);
    // Transient Redis 失敗只發生在 'cluster' 進度發布——此時 embed+cluster 皆已成功。progress publish 是
    // 純觀測副作用（SSE），best-effort：Redis blip 絕不可讓 embed/cluster try/catch 誤判為外部降級而標 partial。
    const jobUpdateProgress = jest.fn<Promise<void>, [{ phase: string; percent: number }]>();
    jobUpdateProgress.mockImplementation((p) =>
      p.phase === 'cluster' ? Promise.reject(new Error('redis blip')) : Promise.resolve(),
    );

    const result = await processor.process(job({}, jobUpdateProgress));

    expect(result).toEqual({ status: 'completed', clusterCount: 2, noiseCount: 0 });
    expect(deps.markStatus).toHaveBeenLastCalledWith('run-1', 'completed', {
      clusterCount: 2,
      noiseCount: 0,
    });
    // 成功且昂貴的管線結果不得被丟棄、run 不得被標成 partial。
    expect(deps.markStatus).not.toHaveBeenCalledWith('run-1', 'partial', expect.anything());
    expect(deps.persist).toHaveBeenCalledTimes(1);
  });

  it('does NOT fail/retry a completed job when a Redis progress-publish blips on an outer-try phase (M8-R12)', async () => {
    const { processor, deps } = makeProcessor();
    deps.findMany.mockResolvedValue([snapshotRow('a'), snapshotRow('b'), snapshotRow('c')]);
    deps.embed.mockResolvedValue([
      [1, 0],
      [1, 0],
      [0, 1],
    ]);
    deps.cluster.mockResolvedValue(clusterResult([0, 0, 1], [0.9, 0.8, 0.95]));
    deps.nameClusters.mockResolvedValue([naming(0), naming(1)]);
    // 'persist' 進度發布在外層 try——同屬 best-effort：Redis blip 也不可讓已持久化的 job 被上拋而整批重試。
    const jobUpdateProgress = jest.fn<Promise<void>, [{ phase: string; percent: number }]>();
    jobUpdateProgress.mockImplementation((p) =>
      p.phase === 'persist' ? Promise.reject(new Error('redis blip')) : Promise.resolve(),
    );

    await expect(processor.process(job({}, jobUpdateProgress))).resolves.toEqual({
      status: 'completed',
      clusterCount: 2,
      noiseCount: 0,
    });
    expect(deps.persist).toHaveBeenCalledTimes(1);
  });

  it('marks partial (0 clusters, no persist) when clustering is unavailable (TC-51)', async () => {
    const { processor, deps } = makeProcessor();
    deps.findMany.mockResolvedValue([snapshotRow('a'), snapshotRow('b')]);
    deps.embed.mockResolvedValue([
      [1, 0],
      [0, 1],
    ]);
    deps.cluster.mockRejectedValue(new ClusteringUnavailableError('cluster-service unavailable'));

    const result = await processor.process(job());

    expect(result).toEqual({ status: 'partial', clusterCount: 0, noiseCount: 2 });
    expect(deps.markStatus).toHaveBeenLastCalledWith(
      'run-1',
      'partial',
      expect.objectContaining({ clusterCount: 0, noiseCount: 2 }),
    );
    expect(deps.nameClusters).not.toHaveBeenCalled();
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('rethrows an infra (Prisma) error for BullMQ retry — not partial', async () => {
    const { processor, deps } = makeProcessor();
    deps.findMany.mockResolvedValue([snapshotRow('a')]);
    deps.embed.mockResolvedValue([[1, 0]]);
    deps.cluster.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('db', { code: 'P1001', clientVersion: 'test' }),
    );

    await expect(processor.process(job())).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    // 不得標 partial（讓 BullMQ 重試整 job）。
    expect(deps.markStatus).not.toHaveBeenCalledWith('run-1', 'partial', expect.anything());
  });

  it('marks partial (clusters still persisted) when a cluster naming is degraded', async () => {
    const { processor, deps } = makeProcessor();
    deps.findMany.mockResolvedValue([snapshotRow('a'), snapshotRow('b')]);
    deps.embed.mockResolvedValue([
      [1, 0],
      [1, 0],
    ]);
    deps.cluster.mockResolvedValue(clusterResult([0, 0], [0.9, 0.8]));
    deps.nameClusters.mockResolvedValue([naming(0, true)]); // degraded

    const result = await processor.process(job());

    expect(result.status).toBe('partial');
    expect(deps.persist).toHaveBeenCalledTimes(1); // 群仍持久化
    expect(deps.markStatus).toHaveBeenLastCalledWith('run-1', 'partial', expect.anything());
  });

  it('degrades SERP to plain-text and continues (partial) when fetch fails', async () => {
    const { processor, deps } = makeProcessor();
    deps.findMany.mockResolvedValue([snapshotRow('a'), snapshotRow('b')]);
    deps.fetch.mockRejectedValue(new Error('serp 500'));
    deps.embed.mockResolvedValue([
      [1, 0],
      [0, 1],
    ]);
    deps.cluster.mockResolvedValue(clusterResult([0, 1], [0.9, 0.9]));
    deps.nameClusters.mockResolvedValue([naming(0), naming(1)]);

    const result = await processor.process(job({ serpEnabled: true }));

    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('partial'); // serpDegraded
    // embed 仍被呼叫（純文字：serp undefined）
    const embedItems = deps.embed.mock.calls[0][0];
    expect(embedItems.every((item) => item.serp === undefined)).toBe(true);
    expect(deps.persist).toHaveBeenCalledTimes(1);
  });

  it('feeds SERP context into embed when serpEnabled and fetch succeeds', async () => {
    const { processor, deps } = makeProcessor();
    deps.findMany.mockResolvedValue([snapshotRow('a'), snapshotRow('b')]);
    deps.fetch.mockResolvedValue([
      {
        normalizedText: 'a',
        keyword: 'a',
        geo: 'US',
        language: 'en',
        provider: 'serpapi',
        results: { organic: [{ position: 1, title: 'Ti', url: 'u', snippet: 'Sn', domain: 'd' }] },
        fetchedAt: new Date(),
      },
    ]);
    deps.embed.mockResolvedValue([
      [1, 0],
      [0, 1],
    ]);
    deps.cluster.mockResolvedValue(clusterResult([0, 1], [0.9, 0.9]));
    deps.nameClusters.mockResolvedValue([naming(0), naming(1)]);

    const result = await processor.process(job({ serpEnabled: true }));

    const items = deps.embed.mock.calls[0][0];
    expect(items.find((item) => item.normalizedText === 'a')?.serp).toEqual({
      organic: [{ title: 'Ti', snippet: 'Sn' }],
      peopleAlsoAsk: undefined,
      relatedSearches: undefined,
    });
    expect(items.find((item) => item.normalizedText === 'b')?.serp).toBeUndefined(); // 無 SERP → 純文字
    expect(result.status).toBe('completed'); // SERP 未降級
  });
});

describe('TopicClusterProcessor worker lifecycle (T8.9b)', () => {
  type FakeWorker = { concurrency: number; run: jest.Mock; close: jest.Mock };

  function withFakeWorker(processor: TopicClusterProcessor, worker: FakeWorker): void {
    (processor as unknown as { _worker: FakeWorker })._worker = worker;
  }

  it('onApplicationBootstrap sets concurrency from config and runs the worker', async () => {
    const { processor } = makeProcessor();
    const worker: FakeWorker = {
      concurrency: 1,
      run: jest.fn().mockResolvedValue(undefined),
      close: jest.fn(),
    };
    withFakeWorker(processor, worker);

    await processor.onApplicationBootstrap();

    expect(worker.concurrency).toBe(3);
    expect(worker.run).toHaveBeenCalledTimes(1);
  });

  it('onApplicationBootstrap does not crash if worker.run rejects (logs scrubbed)', async () => {
    const { processor } = makeProcessor();
    const worker: FakeWorker = {
      concurrency: 1,
      run: jest.fn().mockRejectedValue(new Error('boot failed: redis://u:s3cr3t@h:6379')),
      close: jest.fn(),
    };
    withFakeWorker(processor, worker);

    await expect(processor.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('onModuleDestroy drains the worker; no-op when no worker exists', async () => {
    const { processor } = makeProcessor();
    const worker: FakeWorker = {
      concurrency: 1,
      run: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };
    withFakeWorker(processor, worker);
    await processor.onModuleDestroy();
    expect(worker.close).toHaveBeenCalledTimes(1);

    const fresh = makeProcessor().processor;
    await expect(fresh.onModuleDestroy()).resolves.toBeUndefined();
  });
});

describe('TopicClusterProcessor observability (T8.12)', () => {
  function primeHappy(deps: Deps): void {
    deps.findMany.mockResolvedValue([snapshotRow('a'), snapshotRow('b'), snapshotRow('c')]);
    deps.embed.mockResolvedValue([
      [1, 0],
      [1, 0],
      [0, 1],
    ]);
    deps.cluster.mockResolvedValue(clusterResult([0, 0, 1], [0.9, 0.8, 0.95]));
    deps.nameClusters.mockResolvedValue([naming(0), naming(1)]);
  }

  it('emits a structured metrics log with per-phase timings and counts on completion', async () => {
    const info = jest.fn();
    const { processor, deps } = makeProcessor(info);
    primeHappy(deps);

    await processor.process(job());

    expect(info).toHaveBeenCalledTimes(1);
    const [fields, msg] = info.mock.calls[0] as [Record<string, unknown>, string];
    expect(msg).toBe('topic job metrics');
    expect(fields).toMatchObject({
      status: 'completed',
      keywordCount: 3,
      clusterCount: 2,
      noiseCount: 0,
      degraded: false,
    });
    // 各階段皆被計時（phases 物件含所有階段 key）。
    expect(Object.keys(fields.phases as Record<string, number>).sort()).toEqual(
      ['cluster', 'embed', 'load', 'name', 'persist', 'represent', 'serp'].sort(),
    );
  });

  it('emits partial metrics when clustering degrades', async () => {
    const info = jest.fn();
    const { processor, deps } = makeProcessor(info);
    deps.findMany.mockResolvedValue([snapshotRow('a')]);
    deps.embed.mockResolvedValue([[1, 0]]);
    deps.cluster.mockRejectedValue(new ClusteringUnavailableError('unavailable'));

    await processor.process(job());

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'partial', clusterCount: 0, degraded: true }),
      'topic job metrics',
    );
  });

  it('emit is best-effort: a throwing logger does not fail a completed job', async () => {
    const info = jest.fn().mockImplementation(() => {
      throw new Error('pino down');
    });
    const { processor, deps } = makeProcessor(info);
    primeHappy(deps);

    // 不因觀測副作用而讓 job 失敗（仍回 completed）。
    await expect(processor.process(job())).resolves.toMatchObject({ status: 'completed' });
  });

  it('emits failed metrics before rethrowing an infra error', async () => {
    const info = jest.fn();
    const { processor, deps } = makeProcessor(info);
    deps.findMany.mockResolvedValue([snapshotRow('a')]);
    deps.embed.mockResolvedValue([[1, 0]]);
    deps.cluster.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('db', { code: 'P1001', clientVersion: 'test' }),
    );

    await expect(processor.process(job())).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
      'topic job metrics',
    );
  });
});
