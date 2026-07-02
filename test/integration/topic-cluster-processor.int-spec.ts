import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Job } from 'bullmq';
import { ClusteringUnavailableError } from 'src/clustering/clustering.errors';
import type { ClusterParams, ClusterResult } from 'src/clustering/clustering.types';
import type { topicsConfig } from 'src/config/topics.config';
import type { EmbeddingService } from 'src/embeddings/embedding.service';
import type { PrismaService } from 'src/prisma';
import type { SerpFetchResult, SerpQuery } from 'src/serp/serp.types';
import type { ClusterNaming } from 'src/topics/topic-naming.postprocess';
import type { TopicNamingService } from 'src/topics/topic-naming.service';
import type { TopicJobPayload } from 'src/topics/topic-job.types';
import { TopicClusterProcessor } from 'src/topics/topic-cluster.processor';
import { TopicRepository } from 'src/topics/topic.repository';
import { createPrismaTestApp } from '../utils/create-prisma-test-app';

/**
 * TC-46/TC-51（T8.9b · FR-15/18 · Testcontainers）：TopicClusterProcessor 端到端（外部 client 全 mock、真 DB）——
 * 驗 TopicRun 狀態機 completed/partial + topic_clusters/keyword_cluster_assignments 落地 + snapshot 不可變（讀不寫）。
 */
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

function naming(label: number): ClusterNaming {
  return {
    clusterLabel: label,
    topicName: `T${label}`,
    parentTopic: 'P',
    intentLabel: 'commercial',
    topicType: 'head',
    reason: 'r',
    degraded: false,
  };
}

const CONFIG = { queueConcurrency: 3 } as ConfigType<typeof topicsConfig>;

describe('TopicClusterProcessor (integration · Testcontainers, TC-46/TC-51)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repo: TopicRepository;

  const fetch = jest.fn<Promise<SerpFetchResult[]>, [SerpQuery[]]>();
  const embed = jest.fn<Promise<number[][]>, [unknown[]]>();
  const cluster = jest.fn<Promise<ClusterResult>, [number[][], ClusterParams | undefined]>();
  const nameClusters = jest.fn<Promise<ClusterNaming[]>, [unknown[]]>();

  let processor: TopicClusterProcessor;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
    repo = new TopicRepository(prisma);
    processor = new TopicClusterProcessor(
      prisma,
      { fetch }, // SerpProvider（interface；結構相符）
      { embed } as unknown as EmbeddingService, // class（private brand）→ 需 cast
      { cluster }, // ClusteringProvider（interface）
      { nameClusters } as unknown as TopicNamingService, // class → 需 cast
      repo,
      CONFIG,
    );
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(async () => {
    jest.clearAllMocks();
    await prisma.$executeRawUnsafe('DELETE FROM keyword_cluster_assignments');
    await prisma.$executeRawUnsafe('DELETE FROM topic_clusters');
    await prisma.$executeRawUnsafe('DELETE FROM topic_cluster_runs');
    await prisma.$executeRawUnsafe('DELETE FROM snapshot_rows');
    await prisma.$executeRawUnsafe('DELETE FROM result_snapshots');
  });

  /** 種一個不可變 snapshot（ResultSnapshot + N 個 SnapshotRow）。回 snapshotId。 */
  async function seedSnapshot(
    texts: string[],
  ): Promise<{ snapshotId: string; analysisId: string }> {
    const snapshotId = randomUUID();
    const analysisId = randomUUID();
    await prisma.resultSnapshot.create({
      data: { id: snapshotId, analysisId, keywordCount: texts.length, checksum: 'chk' },
    });
    await prisma.snapshotRow.createMany({
      data: texts.map((text, rowIndex) => ({
        snapshotId,
        analysisId,
        rowIndex,
        data: { text, normalizedText: text, avgMonthlySearches: 100 },
      })),
    });
    return { snapshotId, analysisId };
  }

  async function makeJob(snapshotId: string, analysisId: string): Promise<Job<TopicJobPayload>> {
    const { runId } = await repo.createRun({
      keywordAnalysisId: analysisId,
      snapshotId,
      idempotencyKey: randomUUID(),
      params: { serpEnabled: false },
    });
    return {
      data: {
        runId,
        analysisId,
        snapshotId,
        geo: 'US',
        language: 'en',
        params: {
          serpEnabled: false,
          embeddingModel: 'gemini-embedding-001',
          embeddingSchemaVersion: 'v1',
          promptVersion: 'v1',
          schemaVersion: 'v1',
        },
      },
      updateProgress: jest.fn().mockResolvedValue(undefined), // BullMQ SSE 進度（M8-R8）
    } as unknown as Job<TopicJobPayload>;
  }

  it('completes end-to-end: persists clusters + assignments, TopicRun=completed, snapshot immutable', async () => {
    const { snapshotId, analysisId } = await seedSnapshot(['a', 'b', 'c']);
    embed.mockResolvedValue([
      [1, 0],
      [1, 0],
      [0, 1],
    ]);
    cluster.mockResolvedValue(clusterResult([0, 0, 1], [0.9, 0.8, 0.95]));
    nameClusters.mockResolvedValue([naming(0), naming(1)]);
    const job = await makeJob(snapshotId, analysisId);

    const result = await processor.process(job);

    expect(result).toEqual({ status: 'completed', clusterCount: 2, noiseCount: 0 });
    const run = await prisma.topicRun.findUniqueOrThrow({ where: { id: job.data.runId } });
    expect(run.status).toBe('completed');
    expect(run.clusterCount).toBe(2);
    expect(await prisma.topicCluster.count({ where: { runId: job.data.runId } })).toBe(2);
    expect(await prisma.keywordClusterAssignment.count({ where: { runId: job.data.runId } })).toBe(
      3,
    );
    // snapshot 不可變：processor 只讀不寫。
    expect(await prisma.snapshotRow.count({ where: { snapshotId } })).toBe(3);
  });

  it('marks the run partial with no clusters when clustering is unavailable (TC-51)', async () => {
    const { snapshotId, analysisId } = await seedSnapshot(['a', 'b']);
    embed.mockResolvedValue([
      [1, 0],
      [0, 1],
    ]);
    cluster.mockRejectedValue(new ClusteringUnavailableError('cluster-service unavailable'));
    const job = await makeJob(snapshotId, analysisId);

    const result = await processor.process(job);

    expect(result.status).toBe('partial');
    const run = await prisma.topicRun.findUniqueOrThrow({ where: { id: job.data.runId } });
    expect(run.status).toBe('partial');
    expect(run.clusterCount).toBe(0);
    expect(await prisma.topicCluster.count({ where: { runId: job.data.runId } })).toBe(0);
    expect(nameClusters).not.toHaveBeenCalled();
  });
});
