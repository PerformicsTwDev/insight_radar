import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { ConfigType } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import type { CacheService } from 'src/cache/cache.service';
import type { AuthenticatedUser } from 'src/common/authenticated-user';
import { queryConfig } from 'src/config/query.config';
import type { queueConfig } from 'src/config/queue.config';
import {
  type CreateAnalysisInput,
  KeywordAnalysisService,
} from 'src/keyword-analysis/keyword-analysis.service';
import type { SnapshotRowData } from 'src/keyword-analysis/result-snapshot.checksum';
import { KeywordsModule } from 'src/keywords/keywords.module';
import { SnapshotQueryService } from 'src/keywords/snapshot-query.service';
import { PrismaService } from 'src/prisma';
import type { embeddingsConfig } from 'src/config/embeddings.config';
import type { topicsConfig } from 'src/config/topics.config';
import type { KeywordAssignment, TopicClusterRecord } from 'src/topics/assemble-assignments';
import { TopicRepository } from 'src/topics/topic.repository';
import { TopicsService } from 'src/topics/topics.service';

/**
 * TC-62（FR-27 / NFR-15 · Testcontainers 真 Postgres）：owner 隔離的 **DB 層強制**——
 * A 建立的分析 B 讀取 → 404；`?ownerId=` 不可繞過（service/repository 層強制）；`x-api-key`（機器 actor）
 * 不被 owner 過濾（回全部）；舊 null-owner 列為共享（session 可見）；建立時 session 歸屬 actor.id、apiKey 為 null。
 * 於 service 直接以 actor 呼叫（owner scope 只源自 actor、無任何 ownerId 參數可傳入拓寬）。
 */
const OWNER_A = randomUUID();
const OWNER_B = randomUUID();
const SESSION_A: AuthenticatedUser = { kind: 'session', id: OWNER_A, email: 'a@example.com' };
const SESSION_B: AuthenticatedUser = { kind: 'session', id: OWNER_B, email: 'b@example.com' };
const API_KEY: AuthenticatedUser = { kind: 'apiKey' };

const LIMIT_ENV_KEYS = ['QUERY_MAX_PAGE_SIZE', 'AGG_MAX_BUCKETS', 'AGG_MAX_GROUPS'] as const;

function srow(over: Partial<SnapshotRowData> = {}): SnapshotRowData {
  return {
    text: 'kw',
    normalizedText: 'kw',
    avgMonthlySearches: 100,
    competition: 'LOW',
    competitionIndex: 10,
    cpcLow: 1,
    cpcHigh: 2,
    intent: ['informational'],
    monthlyVolumes: [],
    ...over,
  };
}

describe('owner scope isolation (integration · Testcontainers, TC-62 / FR-27)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let snapshotQuery: SnapshotQueryService;
  let kaService: KeywordAnalysisService;
  let topicRepo: TopicRepository;
  let topicsService: TopicsService;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of LIMIT_ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
    process.env.QUERY_MAX_PAGE_SIZE = '200';
    process.env.AGG_MAX_BUCKETS = '200';
    process.env.AGG_MAX_GROUPS = '1000';
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [queryConfig] }), KeywordsModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    snapshotQuery = moduleRef.get(SnapshotQueryService);

    // KeywordAnalysisService 直接構造（真 prisma + 佇列/快取替身）——聚焦 owner 過濾的 DB 語意。
    const queueStub = {
      add: jest.fn().mockResolvedValue({ id: 'job' }),
      remove: jest.fn().mockResolvedValue(undefined),
    } as unknown as Queue;
    const cacheStub = {
      buildKey: (ns: string, ...parts: (string | number)[]) => [ns, ...parts].join(':'),
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
    } as unknown as CacheService;
    const queueCfg = {
      jobAttempts: 5,
      jobBackoffMs: 3000,
      jobBackoffJitter: 0.2,
      idempTtlMs: 86_400_000,
      jobTtlMs: 259_200_000,
    } as unknown as ConfigType<typeof queueConfig>;
    const queryCfg = { maxPageSize: 200 } as unknown as ConfigType<typeof queryConfig>;
    kaService = new KeywordAnalysisService(queueStub, cacheStub, prisma, queueCfg, queryCfg);

    // TopicsService（topics 子資源）同樣直接構造（真 prisma/repo + 佇列/config 替身）——驗 owner gate 於
    // create/getTopics/getRunRef 的 DB 語意（越權/未知 → 404 或 SSE EMPTY；apiKey 不過濾）。
    topicRepo = new TopicRepository(prisma);
    const topicsCfg = {
      promptVersion: 'v1',
      schemaVersion: 'v1',
    } as unknown as ConfigType<typeof topicsConfig>;
    const embeddingsCfg = {
      model: 'gemini-embedding-001',
      schemaVersion: 'v1',
    } as unknown as ConfigType<typeof embeddingsConfig>;
    topicsService = new TopicsService(
      queueStub,
      prisma,
      topicRepo,
      topicsCfg,
      embeddingsCfg,
      queueCfg,
    );
  });

  afterEach(async () => {
    // topics 子資源（無 FK 至 analysis/snapshot 列，但 clusters→runs 有 FK：先 assignments/clusters 再 runs）。
    await prisma.keywordClusterAssignment.deleteMany();
    await prisma.topicCluster.deleteMany();
    await prisma.topicRun.deleteMany();
    await prisma.snapshotRow.deleteMany();
    await prisma.keywordAnalysis.updateMany({ data: { resultSnapshotId: null } });
    await prisma.resultSnapshot.deleteMany();
    await prisma.keywordAnalysis.deleteMany();
  });

  afterAll(async () => {
    await moduleRef.close();
    for (const key of LIMIT_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  /** 建立一筆 completed analysis（+ 不可變 snapshot）於真 Postgres，回 analysisId。 */
  async function seedCompleted(ownerId: string | null): Promise<string> {
    const analysisId = randomUUID();
    const snapshotId = randomUUID();
    await prisma.keywordAnalysis.create({
      data: {
        id: analysisId,
        status: 'running',
        seeds: [],
        params: {},
        progress: {},
        idempotencyKey: `idem-${analysisId}`,
        ownerId,
      },
    });
    await prisma.resultSnapshot.create({
      data: { id: snapshotId, analysisId, keywordCount: 1, checksum: 'x' },
    });
    await prisma.snapshotRow.create({
      data: {
        snapshotId,
        analysisId,
        rowIndex: 0,
        data: srow() as unknown as Prisma.InputJsonValue,
      },
    });
    await prisma.keywordAnalysis.update({
      where: { id: analysisId },
      data: { status: 'completed', resultSnapshotId: snapshotId },
    });
    return analysisId;
  }

  /** 建立一筆 running analysis（無 snapshot），回 analysisId（供 cancel 的越權寫入守門測試）。 */
  async function seedRunning(ownerId: string | null): Promise<string> {
    const analysisId = randomUUID();
    await prisma.keywordAnalysis.create({
      data: {
        id: analysisId,
        status: 'running',
        seeds: [],
        params: {},
        progress: {},
        idempotencyKey: `idem-${analysisId}`,
        ownerId,
      },
    });
    return analysisId;
  }

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
      representativeKeywords: [],
    };
  }

  function assignment(normalizedText: string, clusterLabel: number): KeywordAssignment {
    return {
      normalizedText,
      clusterLabel,
      topicName: null,
      parentTopic: null,
      intentLabel: null,
      confidence: 0.9,
      isNoise: false,
    };
  }

  /** 為既有 completed analysis 建一筆 completed TopicRun（+ 1 群 + 1 指派），使 GET topics 有意義。 */
  async function seedTopicRunFor(analysisId: string): Promise<string> {
    const snap = await prisma.resultSnapshot.findFirstOrThrow({ where: { analysisId } });
    const { runId } = await topicRepo.createRun({
      keywordAnalysisId: analysisId,
      snapshotId: snap.id,
      idempotencyKey: `topic-idem-${analysisId}`,
      params: {},
    });
    await topicRepo.markStatus(runId, 'completed', { clusterCount: 1, noiseCount: 0 });
    // srow() 預設 normalizedText='kw'（loadKeywordTexts 對得上）→ 指派掛在 label 0 的群。
    await topicRepo.persist(runId, [clusterRecord()], [assignment('kw', 0)]);
    return runId;
  }

  describe('list (FR-23 / AC-27.3/27.5)', () => {
    it('session actor sees only its own + shared null-owner rows (not another owner)', async () => {
      const aId = await seedCompleted(OWNER_A);
      const bId = await seedCompleted(OWNER_B);
      const nullId = await seedCompleted(null);

      const res = await kaService.list({}, SESSION_A);
      const ids = res.data.map((r) => r.analysisId);
      expect(ids).toContain(aId); // 自己的
      expect(ids).toContain(nullId); // 共享（null-owner）
      expect(ids).not.toContain(bId); // 他人的 → 不可見
    });

    it('apiKey (machine) actor sees ALL rows (not owner-filtered)', async () => {
      const aId = await seedCompleted(OWNER_A);
      const bId = await seedCompleted(OWNER_B);
      const nullId = await seedCompleted(null);

      const res = await kaService.list({}, API_KEY);
      const ids = res.data.map((r) => r.analysisId);
      expect(ids).toEqual(expect.arrayContaining([aId, bId, nullId]));
      expect(res.meta.total).toBe(3);
    });

    it('a `?ownerId=B` style request param cannot widen scope (owner derived solely from actor)', async () => {
      const aId = await seedCompleted(OWNER_A);
      const bId = await seedCompleted(OWNER_B);

      // 模擬客戶端塞入 ownerId 想拓寬 scope：service 只認 actor，忽略任何 ownerId-like 輸入。
      const res = await kaService.list(
        { ownerId: OWNER_B } as unknown as Parameters<KeywordAnalysisService['list']>[0],
        SESSION_A,
      );
      const ids = res.data.map((r) => r.analysisId);
      expect(ids).toContain(aId);
      expect(ids).not.toContain(bId); // ?ownerId=B 被忽略 → 仍看不到 B
    });
  });

  describe('getStatus (FR-8 / AC-27.3/27.4 — cross-owner → 404)', () => {
    it("returns 404 when a session actor reads another owner's analysis (no existence leak)", async () => {
      const bId = await seedCompleted(OWNER_B);
      await expect(kaService.getStatus(bId, SESSION_A)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('allows a session actor to read its own analysis', async () => {
      const aId = await seedCompleted(OWNER_A);
      const res = await kaService.getStatus(aId, SESSION_A);
      expect(res.status).toBe('completed');
    });

    it('allows a session actor to read a shared null-owner (legacy) analysis', async () => {
      const nullId = await seedCompleted(null);
      const res = await kaService.getStatus(nullId, SESSION_A);
      expect(res.status).toBe('completed');
    });

    it('apiKey (machine) actor can read any analysis regardless of owner', async () => {
      const bId = await seedCompleted(OWNER_B);
      const res = await kaService.getStatus(bId, API_KEY);
      expect(res.status).toBe('completed');
    });
  });

  describe('cancel (FR-8 / AC-27.3/27.4 — owner gate before state change)', () => {
    it("returns 404 and does NOT cancel another owner's running analysis", async () => {
      const bRunning = await seedRunning(OWNER_B);
      await expect(kaService.cancel(bRunning, SESSION_A)).rejects.toBeInstanceOf(NotFoundException);
      const row = await prisma.keywordAnalysis.findUnique({ where: { id: bRunning } });
      expect(row?.status).toBe('running'); // 越權 → 未被改成 canceled
    });

    it('allows the owner (session) to cancel its own running analysis', async () => {
      const aRunning = await seedRunning(OWNER_A);
      const out = await kaService.cancel(aRunning, SESSION_A);
      expect(out.status).toBe('canceled');
    });

    it('apiKey (machine) actor can cancel any running analysis', async () => {
      const bRunning = await seedRunning(OWNER_B);
      const out = await kaService.cancel(bRunning, API_KEY);
      expect(out.status).toBe('canceled');
    });
  });

  describe('listKeywords + query (FR-3/14 / AC-27.3/27.4)', () => {
    it("returns 404 for a session actor reading another owner's keywords/query", async () => {
      const bId = await seedCompleted(OWNER_B);
      await expect(snapshotQuery.listKeywords(bId, {}, {}, {}, SESSION_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        snapshotQuery.query(bId, { view: 'keywords' }, SESSION_A),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('allows the owner + shared null-owner rows through keywords/query', async () => {
      const aId = await seedCompleted(OWNER_A);
      const nullId = await seedCompleted(null);
      const own = await snapshotQuery.listKeywords(aId, {}, {}, {}, SESSION_A);
      expect(own.data).toHaveLength(1);
      const shared = await snapshotQuery.query(nullId, { view: 'keywords' }, SESSION_A);
      expect(shared).toBeDefined();
    });

    it('apiKey (machine) actor reads any analysis keywords/query (no owner filter)', async () => {
      const bId = await seedCompleted(OWNER_B);
      const res = await snapshotQuery.listKeywords(bId, {}, {}, {}, API_KEY);
      expect(res.data).toHaveLength(1);
    });
  });

  describe('create attribution (AC-27.1)', () => {
    const input: CreateAnalysisInput = {
      seeds: ['owner attribution seed'],
      params: { geo: 'TW', language: 'zh-TW', mode: 'expand', includeAdult: false },
    };

    it('persists ownerId = actor.id when created by a session actor', async () => {
      const { analysisId } = await kaService.create(input, SESSION_A);
      const row = await prisma.keywordAnalysis.findUnique({
        where: { id: analysisId },
        select: { ownerId: true },
      });
      expect(row?.ownerId).toBe(OWNER_A);
    });

    it('persists ownerId = null when created by an apiKey (machine) actor', async () => {
      const { analysisId } = await kaService.create({ ...input, seeds: ['machine seed'] }, API_KEY);
      const row = await prisma.keywordAnalysis.findUnique({
        where: { id: analysisId },
        select: { ownerId: true },
      });
      expect(row?.ownerId).toBeNull();
    });
  });

  describe('topics sub-resource (FR-15/18 / AC-27.3 — cross-owner → 404 / EMPTY)', () => {
    it("returns 404 when a session actor GETs another owner's topics (no existence leak)", async () => {
      const aId = await seedCompleted(OWNER_A);
      await seedTopicRunFor(aId);
      await expect(topicsService.getTopics(aId, SESSION_B)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('allows the owner (session) to GET its own topics', async () => {
      const aId = await seedCompleted(OWNER_A);
      await seedTopicRunFor(aId);
      const res = await topicsService.getTopics(aId, SESSION_A);
      expect(res.status).toBe('completed');
      expect(res.clusters).toHaveLength(1);
      expect(res.clusters[0]).toMatchObject({ topicName: 'Coffee', intentLabel: 'commercial' });
    });

    it('apiKey (machine) actor GETs topics of any owner (not owner-filtered)', async () => {
      const aId = await seedCompleted(OWNER_A);
      await seedTopicRunFor(aId);
      const res = await topicsService.getTopics(aId, API_KEY);
      expect(res.clusters).toHaveLength(1);
    });

    it("returns 404 and creates NO TopicRun when a session actor POSTs on another owner's analysis", async () => {
      const aId = await seedCompleted(OWNER_A);
      await expect(topicsService.create(aId, {}, SESSION_B)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // 越權 → 不對別人 snapshot 建 TopicRun（避免觸發昂貴分群 job）。
      const count = await prisma.topicRun.count({ where: { keywordAnalysisId: aId } });
      expect(count).toBe(0);
    });

    it('allows the owner (session) to POST (enqueue) a topic run on its own analysis', async () => {
      const aId = await seedCompleted(OWNER_A);
      const res = await topicsService.create(aId, {}, SESSION_A);
      expect(res.topicJobId).toBeDefined();
      const count = await prisma.topicRun.count({ where: { keywordAnalysisId: aId } });
      expect(count).toBe(1);
    });
  });
});
