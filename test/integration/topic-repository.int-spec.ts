import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from 'src/prisma';
import type { KeywordAssignment, TopicClusterRecord } from 'src/topics/assemble-assignments';
import { TopicRepository } from 'src/topics/topic.repository';
import { createPrismaTestApp } from '../utils/create-prisma-test-app';

/**
 * TC-45（T8.8 · FR-18 · Testcontainers）：topic_clusters / keyword_cluster_assignments 持久化往返。
 * 驗 persist → 讀回群命名/BigInt clusterVolume/Json 代表字、assignment clusterId 由 label 解析（noise→null），
 * 且**不觸碰 FR-4 keyword_intents**（分表互補）。
 */
function clusterRecord(
  clusterLabel: number,
  over: Partial<TopicClusterRecord> = {},
): TopicClusterRecord {
  return {
    clusterLabel,
    topicName: `Topic ${clusterLabel}`,
    parentTopic: `Parent ${clusterLabel}`,
    intentLabel: 'commercial',
    topicType: 'head',
    reason: 'because',
    clusterVolume: 150,
    keywordCount: 2,
    confidence: 0.8,
    representativeKeywords: [
      { text: 'a', normalizedText: 'a', probability: 0.9, avgMonthlySearches: 100 },
    ],
    ...over,
  };
}

function assignment(
  normalizedText: string,
  clusterLabel: number | null,
  isNoise = false,
): KeywordAssignment {
  return {
    normalizedText,
    clusterLabel,
    topicName: null,
    parentTopic: null,
    intentLabel: null,
    confidence: isNoise ? 0 : 0.9,
    isNoise,
  };
}

describe('TopicRepository (integration · Testcontainers, TC-45)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repo: TopicRepository;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
    repo = new TopicRepository(prisma);
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(async () => {
    // FK 順序：assignments / clusters（→ runs）先於 runs。
    await prisma.$executeRawUnsafe('DELETE FROM keyword_cluster_assignments');
    await prisma.$executeRawUnsafe('DELETE FROM topic_clusters');
    await prisma.$executeRawUnsafe('DELETE FROM topic_cluster_runs');
  });

  async function createRun(): Promise<string> {
    const run = await prisma.topicRun.create({
      data: {
        keywordAnalysisId: randomUUID(),
        snapshotId: randomUUID(),
        status: 'running',
        params: {},
        progress: {},
        idempotencyKey: randomUUID(),
      },
    });
    return run.id;
  }

  it('persists clusters and resolves each assignment clusterId from its label', async () => {
    const runId = await createRun();
    await repo.persist(
      runId,
      [clusterRecord(0), clusterRecord(1)],
      [assignment('a', 0), assignment('b', 1), assignment('n', null, true)],
    );

    const clusters = await prisma.topicCluster.findMany({
      where: { runId },
      orderBy: { clusterLabel: 'asc' },
    });
    expect(clusters.map((c) => c.clusterLabel)).toEqual([0, 1]);

    const idByLabel = new Map(clusters.map((c) => [c.clusterLabel, c.id]));
    const rows = await prisma.keywordClusterAssignment.findMany({
      where: { runId },
      orderBy: { normalizedText: 'asc' },
    });
    expect(rows).toHaveLength(3);
    const byText = new Map(rows.map((r) => [r.normalizedText, r]));
    expect(byText.get('a')?.clusterId).toBe(idByLabel.get(0));
    expect(byText.get('b')?.clusterId).toBe(idByLabel.get(1));
    expect(byText.get('n')?.clusterId).toBeNull(); // noise → null
    expect(byText.get('n')?.isNoise).toBe(true);
  });

  it('round-trips a BigInt clusterVolume and Json representativeKeywords', async () => {
    const runId = await createRun();
    await repo.persist(runId, [clusterRecord(0, { clusterVolume: 150 })], [assignment('a', 0)]);

    const [cluster] = await prisma.topicCluster.findMany({ where: { runId } });
    expect(cluster.clusterVolume).toBe(150n); // BigInt 往返
    expect(cluster.representativeKeywords).toEqual([
      { text: 'a', normalizedText: 'a', probability: 0.9, avgMonthlySearches: 100 },
    ]);
  });

  it('preserves a null clusterVolume (not zero-filled)', async () => {
    const runId = await createRun();
    await repo.persist(runId, [clusterRecord(0, { clusterVolume: null })], [assignment('a', 0)]);

    const [cluster] = await prisma.topicCluster.findMany({ where: { runId } });
    expect(cluster.clusterVolume).toBeNull();
  });

  it('never writes to FR-4 keyword_intents (separate tables)', async () => {
    const runId = await createRun();
    await repo.persist(runId, [clusterRecord(0)], [assignment('a', 0)]);

    const intentCount = await prisma.keywordIntent.count();
    expect(intentCount).toBe(0);
  });
});
