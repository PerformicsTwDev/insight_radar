import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { AuthenticatedUser } from 'src/common/authenticated-user';
import type { embeddingsConfig } from 'src/config/embeddings.config';
import type { queueConfig } from 'src/config/queue.config';
import type { topicsConfig } from 'src/config/topics.config';
import type { PrismaService } from 'src/prisma';
import type { KeywordAssignment, TopicClusterRecord } from 'src/topics/assemble-assignments';
import { TopicRepository } from 'src/topics/topic.repository';
import { TopicsService } from 'src/topics/topics.service';
import { createPrismaTestApp } from '../utils/create-prisma-test-app';

/**
 * TC-49（T8.10b · FR-18 · Testcontainers）：`GET /topics` 回應組裝端到端（真 DB）——驗 clusters + 每字 labels
 * （群繼承）、noise、meta，且**不覆寫 FR-4 keyword_intents**（群層 intent 與每字 multi-label 分表）。
 */
const DUMMY = {} as ConfigType<typeof topicsConfig>;
// getTopics 現閘父 KeywordAnalysis.ownerId（FR-27）：apiKey 為 no-op（見全部）；owner 隔離另於 owner-scope.int-spec。
const ACTOR: AuthenticatedUser = { kind: 'apiKey' };

function clusterRecord(): TopicClusterRecord {
  return {
    clusterLabel: 0,
    topicName: 'Coffee',
    parentTopic: 'Beverages',
    intentLabel: 'commercial',
    topicType: 'head',
    reason: 'buying signals',
    clusterVolume: 100,
    keywordCount: 1,
    confidence: 0.9,
    representativeKeywords: [
      {
        text: 'Coffee Maker',
        normalizedText: 'coffee maker',
        probability: 0.9,
        avgMonthlySearches: 100,
      },
    ],
  };
}

function assignment(normalizedText: string, clusterLabel: number | null): KeywordAssignment {
  const isNoise = clusterLabel === null;
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

describe('TopicsService.getTopics (integration · Testcontainers, TC-49)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repo: TopicRepository;
  let service: TopicsService;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
    repo = new TopicRepository(prisma);
    service = new TopicsService(
      {} as unknown as Queue,
      prisma,
      repo,
      DUMMY,
      {} as ConfigType<typeof embeddingsConfig>,
      {} as ConfigType<typeof queueConfig>,
    );
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM keyword_cluster_assignments');
    await prisma.$executeRawUnsafe('DELETE FROM topic_clusters');
    await prisma.$executeRawUnsafe('DELETE FROM topic_cluster_runs');
    await prisma.$executeRawUnsafe('DELETE FROM snapshot_rows');
    await prisma.$executeRawUnsafe('DELETE FROM result_snapshots');
    await prisma.$executeRawUnsafe('DELETE FROM keyword_analyses');
    await prisma.$executeRawUnsafe('DELETE FROM keyword_intents');
  });

  /** 建立父 KeywordAnalysis（owner gate 需其存在；ownerId=null＝共享，apiKey/session 皆通過），回 analysisId。 */
  async function seedAnalysis(): Promise<string> {
    const analysisId = randomUUID();
    await prisma.keywordAnalysis.create({
      data: {
        id: analysisId,
        status: 'completed',
        seeds: [],
        params: {},
        progress: {},
        idempotencyKey: `idem-${analysisId}`,
        ownerId: null,
      },
    });
    return analysisId;
  }

  async function seedCompletedRun(): Promise<string> {
    const analysisId = await seedAnalysis();
    const snapshotId = randomUUID();
    await prisma.resultSnapshot.create({
      data: { id: snapshotId, analysisId, keywordCount: 2, checksum: 'chk' },
    });
    await prisma.snapshotRow.createMany({
      data: [
        {
          snapshotId,
          analysisId,
          rowIndex: 0,
          data: { text: 'Coffee Maker', normalizedText: 'coffee maker', avgMonthlySearches: 100 },
        },
        {
          snapshotId,
          analysisId,
          rowIndex: 1,
          data: { text: 'random noise', normalizedText: 'noise kw', avgMonthlySearches: null },
        },
      ],
    });
    const { runId } = await repo.createRun({
      keywordAnalysisId: analysisId,
      snapshotId,
      idempotencyKey: randomUUID(),
      params: {},
    });
    await repo.markStatus(runId, 'completed', { clusterCount: 1, noiseCount: 1 });
    await repo.persist(
      runId,
      [clusterRecord()],
      [assignment('coffee maker', 0), assignment('noise kw', null)],
    );
    return analysisId;
  }

  it('404 when the analysis has no topic run', async () => {
    // 父分析存在（通過 owner gate）但無 run → "no topic run" 分支 404（非 owner/未知 id）。
    const analysisId = await seedAnalysis();
    await expect(service.getTopics(analysisId, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 when the parent analysis does not exist (owner gate)', async () => {
    // 未知 analysisId → owner gate 先擋（與越權同一 404，不洩漏存在性）。
    await expect(service.getTopics(randomUUID(), ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns clusters + per-keyword labels with group inheritance and original text', async () => {
    const analysisId = await seedCompletedRun();

    const res = await service.getTopics(analysisId, ACTOR);

    expect(res.status).toBe('completed');
    expect(res.meta).toMatchObject({ clusterCount: 1, noiseCount: 1 });
    expect(res.clusters[0]).toMatchObject({
      topicName: 'Coffee',
      intentLabel: 'commercial',
      clusterVolume: 100,
    });

    const byNorm = new Map(res.keywords.map((k) => [k.normalizedText, k]));
    expect(byNorm.get('coffee maker')).toMatchObject({
      text: 'Coffee Maker', // snapshot 原字
      topicName: 'Coffee',
      intentLabel: 'commercial', // 由群繼承
      isNoise: false,
    });
    expect(byNorm.get('noise kw')).toMatchObject({
      topicName: null,
      intentLabel: null,
      isNoise: true,
    });
  });

  it('does not read or overwrite FR-4 keyword_intents (separate tables)', async () => {
    const analysisId = await seedCompletedRun();
    // FR-4 每字 multi-label（不同於群層 intent）。
    await prisma.keywordIntent.create({
      data: { normalizedText: 'coffee maker', modelVersion: 'v1', labels: ['informational'] },
    });

    const res = await service.getTopics(analysisId, ACTOR);

    // 群層 intentLabel 來自 topic_clusters（commercial），與 keyword_intents（informational）分表互補。
    const kw = res.keywords.find((k) => k.normalizedText === 'coffee maker');
    expect(kw?.intentLabel).toBe('commercial');
    // keyword_intents 未被動。
    expect(await prisma.keywordIntent.count()).toBe(1);
  });
});
