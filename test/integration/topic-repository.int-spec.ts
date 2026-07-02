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

  it('persist is idempotent on job re-entry (BullMQ retry does not P2002, M8-R1)', async () => {
    const runId = await createRun();
    await repo.persist(
      runId,
      [clusterRecord(0), clusterRecord(1)],
      [assignment('a', 0), assignment('b', 1)],
    );

    // 模擬 BullMQ 重跑同 job（例如 persist 後 markStatus 拋暫時錯）→ 再 persist 同 runId。
    // 修前：assignments PK (run_id, normalized_text) → P2002 → transaction rollback → job 永久失敗。
    await expect(
      repo.persist(
        runId,
        [clusterRecord(0), clusterRecord(1)],
        [assignment('a', 0), assignment('b', 1)],
      ),
    ).resolves.toBeUndefined();

    // 冪等：最終仍為一組（覆寫、不重複、不報錯）。
    expect(await prisma.topicCluster.count({ where: { runId } })).toBe(2);
    expect(await prisma.keywordClusterAssignment.count({ where: { runId } })).toBe(2);
  });

  it('re-persist with a different membership overwrites stale rows + re-points assignments (M8-R6)', async () => {
    const runId = await createRun();
    // 首次：2 群 + 3 assignments（a→0, b→1, c→0）。
    await repo.persist(
      runId,
      [clusterRecord(0), clusterRecord(1)],
      [assignment('a', 0), assignment('b', 1), assignment('c', 0)],
    );
    const firstClusterIds = (await prisma.topicCluster.findMany({ where: { runId } })).map(
      (c) => c.id,
    );

    // 重跑（不同結果，如降級）：1 群 + 1 assignment（a→0）。舊的 b/c + cluster 1 應被清除，
    // 且 'a' 應指向**新**的 cluster uuid（delete-by-runId 全清 → createMany 產新 id；clusterId 無 DB FK，
    // 若殘留舊 id 會靜默 dangling）。
    await repo.persist(runId, [clusterRecord(0)], [assignment('a', 0)]);

    expect(await prisma.topicCluster.count({ where: { runId } })).toBe(1);
    const rows = await prisma.keywordClusterAssignment.findMany({ where: { runId } });
    expect(rows.map((r) => r.normalizedText)).toEqual(['a']); // b/c stale 已清
    const newClusterId = (await prisma.topicCluster.findFirstOrThrow({ where: { runId } })).id;
    expect(rows[0].clusterId).toBe(newClusterId); // 指向新 cluster
    expect(firstClusterIds).not.toContain(rows[0].clusterId); // 非首次的舊 id（已 re-point）
  });

  describe('run lifecycle (T8.9a / TC-46)', () => {
    const runInput = (idempotencyKey: string) => ({
      keywordAnalysisId: randomUUID(),
      snapshotId: randomUUID(),
      idempotencyKey,
      params: { serpEnabled: false, promptVersion: 'v1' },
    });

    it('createRun inserts a queued run and returns created=true', async () => {
      const { runId, created } = await repo.createRun(runInput('key-1'));

      expect(created).toBe(true);
      const row = await prisma.topicRun.findUniqueOrThrow({ where: { id: runId } });
      expect(row.status).toBe('queued');
      expect(row.idempotencyKey).toBe('key-1');
    });

    it('createRun is idempotent: same key returns the existing run (created=false)', async () => {
      const first = await repo.createRun(runInput('key-2'));
      const second = await repo.createRun(runInput('key-2'));

      expect(second).toEqual({ runId: first.runId, created: false });
      expect(await prisma.topicRun.count({ where: { idempotencyKey: 'key-2' } })).toBe(1);
    });

    it('findByIdempotencyKey returns id+status or null', async () => {
      const { runId } = await repo.createRun(runInput('key-3'));

      expect(await repo.findByIdempotencyKey('key-3')).toEqual({ id: runId, status: 'queued' });
      expect(await repo.findByIdempotencyKey('missing')).toBeNull();
    });

    it('markStatus updates status + outcome; undefined fields are left untouched', async () => {
      const { runId } = await repo.createRun(runInput('key-4'));

      await repo.markStatus(runId, 'running');
      await repo.markStatus(runId, 'partial', { clusterCount: 3, noiseCount: 5 });

      const row = await prisma.topicRun.findUniqueOrThrow({ where: { id: runId } });
      expect(row.status).toBe('partial');
      expect(row.clusterCount).toBe(3);
      expect(row.noiseCount).toBe(5);
      expect(row.error).toBeNull(); // 未提供 → 不覆寫
    });

    it('updateProgress persists the progress json', async () => {
      const { runId } = await repo.createRun(runInput('key-5'));

      await repo.updateProgress(runId, { phase: 'embed', percent: 40 });

      const row = await prisma.topicRun.findUniqueOrThrow({ where: { id: runId } });
      expect(row.progress).toEqual({ phase: 'embed', percent: 40 });
    });
  });
});
