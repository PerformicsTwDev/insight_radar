import { getQueueToken } from '@nestjs/bullmq';
import { Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CacheService } from '../cache/cache.service';
import { CacheNamespace } from '../cache/cache-namespace';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { queryConfig } from '../config/query.config';
import { queueConfig } from '../config/queue.config';
import { PrismaService } from '../prisma/prisma.service';
import { KEYWORD_ANALYSIS_QUEUE } from '../queue/queue.constants';
import { computeIdempotencyKey } from './idempotency';
import { KeywordAnalysisService } from './keyword-analysis.service';
import type { CreateAnalysisInput } from './keyword-analysis.service';

/** in-memory CacheService 替身（不連 Redis），保留信封語意（miss→undefined）。 */
class FakeCache {
  readonly store = new Map<string, unknown>();
  readonly setCalls: Array<{ key: string; value: unknown; ttlMs?: number }> = [];

  buildKey(namespace: string, ...parts: (string | number)[]): string {
    return [namespace, ...parts].join(':');
  }
  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.store.get(key) as T | undefined);
  }
  set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.setCalls.push({ key, value, ttlMs });
    this.store.set(key, value);
    return Promise.resolve();
  }
}

type Row = Record<string, unknown> & { id: string; idempotencyKey: string };

/**
 * 忠實 prisma 替身：以 `idempotencyKey` 為唯一索引，重複 create 拋真實 P2002（與 DB
 * `@unique` 一致），支援 `findUnique`/`delete`——讓 idempotency 慢路徑（DB 競態/孤兒列）可被測。
 */
class FakePrisma {
  readonly rows: Row[] = [];
  readonly deleted: string[] = [];

  keywordAnalysis = {
    create: jest.fn((args: { data: Row }) => {
      const { idempotencyKey } = args.data;
      if (this.rows.some((r) => r.idempotencyKey === idempotencyKey)) {
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
            meta: { target: ['idempotency_key'] },
          }),
        );
      }
      // 模擬 Prisma `@default(now())`：未顯式提供時戳上 createdAt（idempotency freshness 判定需要）。
      const row: Row = { createdAt: new Date(), ...args.data };
      this.rows.push(row);
      return Promise.resolve(row);
    }),
    findUnique: jest.fn((args: { where: { idempotencyKey?: string; id?: string } }) => {
      const row = this.rows.find(
        (r) =>
          (args.where.idempotencyKey !== undefined &&
            r.idempotencyKey === args.where.idempotencyKey) ||
          (args.where.id !== undefined && r.id === args.where.id),
      );
      return Promise.resolve(row ?? null);
    }),
    delete: jest.fn((args: { where: { id: string } }) => {
      this.deleted.push(args.where.id);
      const idx = this.rows.findIndex((r) => r.id === args.where.id);
      if (idx >= 0) this.rows.splice(idx, 1);
      return Promise.resolve(undefined);
    }),
    update: jest.fn((args: { where: { id: string }; data: Partial<Row> }) => {
      const row = this.rows.find((r) => r.id === args.where.id);
      if (row) Object.assign(row, args.data);
      return Promise.resolve(row ?? null);
    }),
    // 條件更新（M3-R3）：honour `where.status.notIn`——命中（id 對且 status 不在 notIn）才套 data、回 count。
    updateMany: jest.fn(
      (args: { where: { id: string; status?: { notIn?: string[] } }; data: Partial<Row> }) => {
        const notIn = args.where.status?.notIn ?? [];
        const row = this.rows.find(
          (r) => r.id === args.where.id && !notIn.includes(r.status as string),
        );
        if (row) {
          Object.assign(row, args.data);
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      },
    ),
  };

  // journey feature 推導（AC-33.6）：getStatus 查最新 JourneyRun；預設無 run（→ not_generated）。
  journeyRun = {
    findFirst: jest.fn(() => Promise.resolve(null)),
  };

  // ai_search feature 推導（AC-44.2/T15.8a）：getStatus 查最新 linked AiSearchRun（owner-scoped）；預設無 run。
  aiSearchRun = {
    findFirst: jest.fn((_args?: unknown) => Promise.resolve<{ status: string } | null>(null)),
  };

  // topics feature 推導（M7-R7a/AC-14.7）：getStatus 查最新 TopicRun；預設無 run（→ not_generated）。
  topicRun = {
    findFirst: jest.fn(() => Promise.resolve<{ status: string } | null>(null)),
  };
}

const QUEUE_CONFIG = {
  workerConcurrency: 5,
  jobAttempts: 5,
  jobBackoffMs: 3000,
  jobBackoffJitter: 0.2,
  idempTtlMs: 86400000,
  jobTtlMs: 259200000,
};

interface Harness {
  service: KeywordAnalysisService;
  cache: FakeCache;
  prisma: FakePrisma;
  queueAdd: jest.Mock;
  queueGetJob: jest.Mock;
  queueRemove: jest.Mock;
}

async function buildHarness(queueAdd?: jest.Mock): Promise<Harness> {
  const cache = new FakeCache();
  const prisma = new FakePrisma();
  const add = queueAdd ?? jest.fn().mockResolvedValue({ id: 'job-1' });
  const getJob = jest.fn();
  const remove = jest.fn().mockResolvedValue(undefined);

  const moduleRef = await Test.createTestingModule({
    providers: [
      KeywordAnalysisService,
      { provide: getQueueToken(KEYWORD_ANALYSIS_QUEUE), useValue: { add, getJob, remove } },
      { provide: CacheService, useValue: cache },
      { provide: PrismaService, useValue: prisma },
      { provide: queueConfig.KEY, useValue: QUEUE_CONFIG },
      { provide: queryConfig.KEY, useValue: { maxPageSize: 200 } },
    ],
  }).compile();

  return {
    service: moduleRef.get(KeywordAnalysisService),
    cache,
    prisma,
    queueAdd: add,
    queueGetJob: getJob,
    queueRemove: remove,
  };
}

const baseInput: CreateAnalysisInput = {
  seeds: ['Running Shoes', 'trail shoes'],
  params: { geo: 'TW', language: 'zh-TW', mode: 'expand', includeAdult: false },
};

/** 機器 actor（x-api-key）：不套 owner 過濾（FR-27，AC-27.5）——這些既有測試驗非-owner 行為，用機器身分。 */
const API_ACTOR: AuthenticatedUser = { kind: 'apiKey' };

describe('TC-54: idempotency DB 慢路徑 freshness TTL (#311, FR-1/AC-1.4)', () => {
  function seedExisting(prisma: FakePrisma, over: Partial<Row>): Row {
    const row: Row = {
      id: 'seed-id',
      status: 'completed',
      seeds: baseInput.seeds,
      params: baseInput.params,
      progress: { phase: 'done', percent: 100 },
      idempotencyKey: computeIdempotencyKey(baseInput.seeds, baseInput.params, null),
      createdAt: new Date(),
      ...over,
    };
    prisma.rows.push(row);
    return row;
  }

  it('過 IDEMP_TTL_MS 窗後同語意重送 → 建新任務（不再由 DB fallback 永久回舊 analysisId）', async () => {
    const { service, prisma, queueAdd } = await buildHarness();
    const hash = computeIdempotencyKey(baseInput.seeds, baseInput.params, null);
    // 上次分析的舊列：createdAt 超過 idempTtlMs 窗（Redis idemp 快取已過期，不預置）。
    const stale = seedExisting(prisma, {
      id: 'stale-analysis',
      createdAt: new Date(Date.now() - QUEUE_CONFIG.idempTtlMs - 60_000),
    });

    const { analysisId } = await service.create(baseInput, API_ACTOR);

    expect(analysisId).not.toBe(stale.id); // 建了新任務，而非靜默回舊 id（#311）
    expect(queueAdd).toHaveBeenCalledTimes(1); // 新任務確實入列
    const fresh = prisma.rows.find((r) => r.id === analysisId);
    expect(fresh?.idempotencyKey).toBe(hash); // 新列佔用 hash 唯一鍵
    const kept = prisma.rows.find((r) => r.id === stale.id);
    expect(kept).toBeDefined(); // 舊列保留（歷史/snapshot 不刪）
    expect(kept?.idempotencyKey).not.toBe(hash); // 舊列已讓出唯一鍵
  });

  it('窗內同語意重送 → 回同一 analysisId（idempotent，不建新列/不入列）', async () => {
    const { service, prisma, queueAdd } = await buildHarness();
    const winner = seedExisting(prisma, {
      id: 'fresh-winner',
      createdAt: new Date(Date.now() - 1000),
    });

    const { analysisId } = await service.create(baseInput, API_ACTOR);

    expect(analysisId).toBe(winner.id);
    expect(prisma.rows).toHaveLength(1);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('並發旋轉競態：讓位後重試 create 撞他人新列（P2002）→ 回勝者 id（不無限恢復）', async () => {
    const { service, prisma, queueAdd } = await buildHarness();
    const hash = computeIdempotencyKey(baseInput.seeds, baseInput.params, null);
    const stale = seedExisting(prisma, {
      id: 'stale-analysis',
      createdAt: new Date(Date.now() - QUEUE_CONFIG.idempTtlMs - 1000),
    });
    const raceWinner: Row = {
      id: 'race-winner',
      status: 'queued',
      seeds: baseInput.seeds,
      params: baseInput.params,
      progress: { phase: 'queued', percent: 0 },
      idempotencyKey: hash,
      createdAt: new Date(),
    };

    // 讓「讓位後的重試 create」（第 2 次 create）撞 P2002，模擬他人搶先建列佔用 hash。
    const realCreate = prisma.keywordAnalysis.create.getMockImplementation();
    let creates = 0;
    prisma.keywordAnalysis.create.mockImplementation((args: { data: Row }) => {
      creates += 1;
      if (creates === 2) {
        prisma.rows.push(raceWinner); // 並發勝者已落庫 → fallback findUnique 命中
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
        );
      }
      return realCreate!(args);
    });

    const { analysisId } = await service.create(baseInput, API_ACTOR);

    expect(analysisId).toBe(raceWinner.id); // 回並發勝者，不拋、不無限恢復
    expect(queueAdd).not.toHaveBeenCalled();
    expect(prisma.rows.find((r) => r.id === stale.id)?.idempotencyKey).not.toBe(hash); // 舊列仍讓了位
  });

  it('過窗但仍在處理中（queued/running）的既有列 → coalesce 回其 id，不旋轉、不重複入列（M9-R2）', async () => {
    const { service, prisma, queueAdd } = await buildHarness();
    const hash = computeIdempotencyKey(baseInput.seeds, baseInput.params, null);
    // worker 落後：舊列已逾 freshness 窗，但仍在處理中（status=queued）——不得旋轉讓位、不得重複入列
    // （否則相同 seeds 會被重複打 Google Ads、雙倍用量）。
    const inflight = seedExisting(prisma, {
      id: 'inflight-analysis',
      status: 'queued',
      createdAt: new Date(Date.now() - QUEUE_CONFIG.idempTtlMs - 60_000),
    });

    const { analysisId } = await service.create(baseInput, API_ACTOR);

    expect(analysisId).toBe(inflight.id); // coalesce 到進行中的列
    expect(queueAdd).not.toHaveBeenCalled(); // 不重複入列（不重打 Ads）
    expect(prisma.rows).toHaveLength(1); // 沒有建新列
    expect(prisma.rows[0].idempotencyKey).toBe(hash); // 舊列仍持有 hash（未被旋轉讓位）
  });

  it('窗內重送 re-cache 用「剩餘窗」而非從 now 起算全 TTL（不滑動 Redis 快路徑，M9-R3）', async () => {
    const { service, prisma, cache } = await buildHarness();
    // 既有列在窗內、但已用掉約半個窗（createdAt = now − idempTtlMs/2）。
    seedExisting(prisma, {
      id: 'within-window',
      createdAt: new Date(Date.now() - QUEUE_CONFIG.idempTtlMs / 2),
    });

    await service.create(baseInput, API_ACTOR);

    const idempSet = cache.setCalls.find((c) => c.key.startsWith(`${CacheNamespace.IDEMP}:`));
    expect(idempSet).toBeDefined();
    // re-cache TTL 必 **嚴格小於**全 idempTtlMs（≈剩餘半窗）——否則快路徑延壽、逾 DB 窗後仍回 stale。
    expect(idempSet?.ttlMs).toBeLessThan(QUEUE_CONFIG.idempTtlMs);
    expect(idempSet?.ttlMs).toBeGreaterThan(0);
  });
});

describe('KeywordAnalysisService.create (T3.2, TC-10)', () => {
  it('enqueues a new job and persists a queued row + caches on first submit', async () => {
    const { service, queueAdd, prisma, cache } = await buildHarness();

    const { analysisId } = await service.create(baseInput, API_ACTOR);

    expect(analysisId).toMatch(/^[0-9a-f-]{36}$/);
    // queue.add: payload + idempotent jobId + retry policy
    expect(queueAdd).toHaveBeenCalledTimes(1);
    const [, payload, opts] = queueAdd.mock.calls[0] as [
      string,
      Record<string, unknown>,
      {
        jobId: string;
        attempts: number;
        backoff: { type: string; delay: number; jitter: number };
      },
    ];
    expect(payload).toMatchObject({ analysisId, seeds: baseInput.seeds, params: baseInput.params });
    // NFR-9：job-level retry attempts + 指數退避 + jitter（散開重試、避免 thundering herd）。
    expect(opts).toEqual({
      jobId: analysisId,
      attempts: QUEUE_CONFIG.jobAttempts,
      backoff: {
        type: 'exponential',
        delay: QUEUE_CONFIG.jobBackoffMs,
        jitter: QUEUE_CONFIG.jobBackoffJitter,
      },
    });
    // row written with full contract
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]).toMatchObject({
      id: analysisId,
      status: 'queued',
      seeds: baseInput.seeds,
      params: baseInput.params,
    });
    expect(prisma.rows[0].idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    // idemp (id + TTL) and job: (TTL) caches both written
    const idemp = cache.setCalls.filter((c) => c.key.startsWith(`${CacheNamespace.IDEMP}:`));
    expect(idemp).toHaveLength(1);
    expect(idemp[0].value).toBe(analysisId);
    expect(idemp[0].ttlMs).toBe(QUEUE_CONFIG.idempTtlMs);
    const job = cache.setCalls.filter((c) => c.key.startsWith(`${CacheNamespace.JOB}:`));
    expect(job).toHaveLength(1);
    expect(job[0].ttlMs).toBe(QUEUE_CONFIG.jobTtlMs);
  });

  it('returns the SAME analysisId for semantically-equal submits (cache fast-path)', async () => {
    const { service, queueAdd, prisma } = await buildHarness();

    const first = await service.create(baseInput, API_ACTOR);
    const second = await service.create(
      {
        seeds: ['  trail   shoes', 'RUNNING SHOES'],
        params: { includeAdult: false, mode: 'expand', language: 'zh-TW', geo: 'TW' },
      },
      API_ACTOR,
    );

    expect(second.analysisId).toBe(first.analysisId);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(prisma.rows).toHaveLength(1);
  });

  it('recovers from a concurrent duplicate (cache miss + DB P2002) by returning the existing id', async () => {
    const { service, queueAdd, prisma, cache } = await buildHarness();

    // First submit creates the row but we wipe the idemp cache to simulate the racing
    // second request that missed the cache before the first one populated it.
    const first = await service.create(baseInput, API_ACTOR);
    for (const key of [...cache.store.keys()]) {
      if (key.startsWith(`${CacheNamespace.IDEMP}:`)) cache.store.delete(key);
    }

    const second = await service.create(baseInput, API_ACTOR);

    // Must return the existing id, NOT throw P2002, NOT enqueue/create a second row.
    expect(second.analysisId).toBe(first.analysisId);
    expect(prisma.rows).toHaveLength(1);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(prisma.keywordAnalysis.findUnique).toHaveBeenCalled();
  });

  it('does not orphan a queued row when enqueue fails (compensating delete)', async () => {
    const failingAdd = jest.fn().mockRejectedValue(new Error('redis down'));
    const { service, prisma, cache } = await buildHarness(failingAdd);

    await expect(service.create(baseInput, API_ACTOR)).rejects.toThrow('redis down');

    // Row must be rolled back so a retry isn't permanently wedged by P2002.
    expect(prisma.deleted).toHaveLength(1);
    expect(prisma.rows).toHaveLength(0);
    // idemp cache must NOT point at a job that was never enqueued.
    expect(cache.setCalls.some((c) => c.key.startsWith(`${CacheNamespace.IDEMP}:`))).toBe(false);
  });

  it('rethrows a non-unique DB error without enqueueing (no swallow)', async () => {
    const { service, prisma, queueAdd } = await buildHarness();
    prisma.keywordAnalysis.create.mockRejectedValueOnce(new Error('connection reset'));

    await expect(service.create(baseInput, API_ACTOR)).rejects.toThrow('connection reset');
    expect(queueAdd).not.toHaveBeenCalled();
    expect(prisma.keywordAnalysis.findUnique).not.toHaveBeenCalled();
  });

  it('rethrows P2002 when no winner row is found (defensive, no infinite recovery)', async () => {
    const { service, prisma } = await buildHarness();
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['idempotency_key'] },
    });
    // create throws P2002 but findUnique returns null (row vanished) → must rethrow, not loop.
    prisma.keywordAnalysis.create.mockRejectedValueOnce(p2002);
    prisma.keywordAnalysis.findUnique.mockResolvedValueOnce(null);

    await expect(service.create(baseInput, API_ACTOR)).rejects.toBe(p2002);
  });

  it('produces DIFFERENT analysisId when params differ semantically (e.g. geo)', async () => {
    const { service } = await buildHarness();

    const a = await service.create(baseInput, API_ACTOR);
    const b = await service.create(
      {
        seeds: baseInput.seeds,
        params: { ...baseInput.params, geo: 'US' },
      },
      API_ACTOR,
    );

    expect(b.analysisId).not.toBe(a.analysisId);
  });
});

/** 在 FakePrisma 注入一筆可被 `findUnique({where:{id},include:{resultSnapshot}})` 命中的列。 */
function seedRow(
  prisma: FakePrisma,
  row: {
    id: string;
    status: string;
    progress?: unknown;
    seeds?: string[];
    resultSnapshotId?: string | null;
    resultSnapshot?: { id: string; keywordCount: number } | null;
  },
): void {
  prisma.rows.push({
    id: row.id,
    idempotencyKey: `idem-${row.id}`,
    status: row.status,
    progress: row.progress ?? { phase: 'queued', percent: 0 },
    seeds: row.seeds ?? ['seed-a', 'seed-b'],
    resultSnapshotId: row.resultSnapshotId ?? null,
    resultSnapshot: row.resultSnapshot ?? null,
  });
}

describe('KeywordAnalysisService.getStatus (T3.4, TC-22) — DB is source of truth', () => {
  it('throws NotFound for an unknown analysisId', async () => {
    const { service, prisma } = await buildHarness();

    await expect(service.getStatus('missing-id', API_ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.keywordAnalysis.findUnique).toHaveBeenCalledWith({
      where: { id: 'missing-id' },
      include: { resultSnapshot: true },
    });
  });

  it('returns status=queued with progress from the DB row', async () => {
    const { service, prisma } = await buildHarness();
    seedRow(prisma, { id: 'id-1', status: 'queued', progress: { phase: 'queued', percent: 0 } });

    const res = await service.getStatus('id-1', API_ACTOR);

    expect(res).toEqual({
      status: 'queued',
      progress: { phase: 'queued', percent: 0 },
      result: { resultSnapshotId: null, count: null },
      seeds: ['seed-a', 'seed-b'], // AC-8.5：狀態回應恆含建立時 seeds
      // T6.8：features 反映 compute 狀態——queued 無 snapshot → keyword_metrics running；serp/topics/ai_search 未接線。
      features: {
        keyword_metrics: { status: 'running' },
        serp: { status: 'not_generated' },
        topics: { status: 'not_generated' },
        journey: { status: 'not_generated' },
        ai_search: { status: 'not_generated' },
      },
    });
  });

  it('returns the original seeds regardless of status (AC-8.5, enabler for frontend:T7.8)', async () => {
    const { service, prisma } = await buildHarness();
    seedRow(prisma, {
      id: 'id-1',
      status: 'running',
      progress: { phase: 'intent', percent: 40 },
      seeds: ['果汁機', '電鍋'],
    });

    const res = await service.getStatus('id-1', API_ACTOR);

    expect(res.seeds).toEqual(['果汁機', '電鍋']);
  });

  it('returns status=running with phase progress', async () => {
    const { service, prisma } = await buildHarness();
    seedRow(prisma, {
      id: 'id-1',
      status: 'running',
      progress: { phase: 'intent', percent: 72, expanded: 1980, labeled: 1420, total: 1980 },
    });

    const res = await service.getStatus('id-1', API_ACTOR);

    expect(res.status).toBe('running');
    expect(res.progress).toEqual({
      phase: 'intent',
      percent: 72,
      expanded: 1980,
      labeled: 1420,
      total: 1980,
    });
    expect(res.result).toEqual({ resultSnapshotId: null, count: null });
  });

  it('returns status=completed with resultSnapshotId + count from the snapshot (AC-8.4)', async () => {
    const { service, prisma } = await buildHarness();
    seedRow(prisma, {
      id: 'id-1',
      status: 'completed',
      progress: { phase: 'done', percent: 100 },
      resultSnapshotId: 'snap-1',
      resultSnapshot: { id: 'snap-1', keywordCount: 1980 },
    });

    const res = await service.getStatus('id-1', API_ACTOR);

    expect(res.status).toBe('completed');
    expect(res.result).toEqual({ resultSnapshotId: 'snap-1', count: 1980 });
    // T6.8：completed（有 snapshot）→ keyword_metrics ready；serp/topics 之 compute 尚未實作。
    expect(res.features.keyword_metrics.status).toBe('ready');
    expect(res.features.serp.status).toBe('not_generated');
    expect(res.features.topics.status).toBe('not_generated');
  });

  it('surfaces status=partial (BullMQ state cannot express this — AC-8.3)', async () => {
    const { service, prisma } = await buildHarness();
    seedRow(prisma, {
      id: 'id-1',
      status: 'partial',
      progress: { phase: 'intent', percent: 100 },
      resultSnapshotId: 'snap-2',
      resultSnapshot: { id: 'snap-2', keywordCount: 800 },
    });

    const res = await service.getStatus('id-1', API_ACTOR);

    expect(res.status).toBe('partial');
    expect(res.result).toEqual({ resultSnapshotId: 'snap-2', count: 800 });
  });

  it('surfaces status=canceled (set by DELETE — AC-8.3)', async () => {
    const { service, prisma } = await buildHarness();
    seedRow(prisma, { id: 'id-1', status: 'canceled', progress: { phase: 'fetch', percent: 20 } });

    const res = await service.getStatus('id-1', API_ACTOR);

    expect(res.status).toBe('canceled');
    expect(res.result).toEqual({ resultSnapshotId: null, count: null });
  });

  it('returns status=failed with null result', async () => {
    const { service, prisma } = await buildHarness();
    seedRow(prisma, { id: 'id-1', status: 'failed', progress: { phase: 'fetch', percent: 40 } });

    const res = await service.getStatus('id-1', API_ACTOR);

    expect(res.status).toBe('failed');
    expect(res.result).toEqual({ resultSnapshotId: null, count: null });
  });

  it('defaults progress to a queued shape when the row has malformed/empty progress', async () => {
    const { service, prisma } = await buildHarness();
    seedRow(prisma, { id: 'id-1', status: 'queued', progress: null });

    const res = await service.getStatus('id-1', API_ACTOR);

    expect(res.progress).toEqual({ phase: 'queued', percent: 0 });
  });

  it('derives ai_search from the latest linked AiSearchRun (owner-scoped) (T15.8a / #678 G1 / AC-44.2)', async () => {
    const { service, prisma } = await buildHarness();
    seedRow(prisma, {
      id: 'id-1',
      status: 'completed',
      resultSnapshotId: 'snap-1',
      resultSnapshot: { id: 'snap-1', keywordCount: 5 },
    });
    // analysis has a completed linked AiSearchRun → ai_search feature = ready (T15.5 已落庫).
    prisma.aiSearchRun.findFirst.mockResolvedValueOnce({ status: 'completed' });

    const res = await service.getStatus('id-1', API_ACTOR);

    expect(res.features.ai_search.status).toBe('ready');
    // owner-scoped, latest-first, by keywordAnalysisId (apiKey actor → no owner filter, exact where).
    expect(prisma.aiSearchRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { keywordAnalysisId: 'id-1' },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('derives topics from the latest TopicRun (M7-R7a / AC-14.7; no longer hardcoded not_generated)', async () => {
    const { service, prisma } = await buildHarness();
    seedRow(prisma, {
      id: 'id-1',
      status: 'completed',
      resultSnapshotId: 'snap-1',
      resultSnapshot: { id: 'snap-1', keywordCount: 5 },
    });
    // A completed TopicRun → topics feature = ready, so 意圖主題 view shows its table on revisit.
    prisma.topicRun.findFirst.mockResolvedValueOnce({ status: 'completed' });

    const res = await service.getStatus('id-1', API_ACTOR);

    expect(res.features.topics.status).toBe('ready');
    expect(prisma.topicRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { keywordAnalysisId: 'id-1' },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });
});

describe('KeywordAnalysisService.cancel (T3.12, FR-8)', () => {
  it('cancels an in-progress job: status=canceled + releases the queue job', async () => {
    const { service, prisma, queueRemove } = await buildHarness();
    seedRow(prisma, { id: 'id-1', status: 'running' });

    const out = await service.cancel('id-1', API_ACTOR);

    expect(out).toEqual({ status: 'canceled' });
    expect(prisma.rows[0].status).toBe('canceled');
    expect(queueRemove).toHaveBeenCalledWith('id-1'); // jobId === analysisId
  });

  it('cancels a queued job too', async () => {
    const { service, prisma } = await buildHarness();
    seedRow(prisma, { id: 'id-1', status: 'queued' });
    expect((await service.cancel('id-1', API_ACTOR)).status).toBe('canceled');
  });

  it('throws NotFound (404) for an unknown analysisId', async () => {
    const { service } = await buildHarness();
    await expect(service.cancel('ghost', API_ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not re-cancel a terminal job (returns current status, no queue removal)', async () => {
    const { service, prisma, queueRemove } = await buildHarness();
    seedRow(prisma, { id: 'id-1', status: 'completed' });

    const out = await service.cancel('id-1', API_ACTOR);

    expect(out).toEqual({ status: 'completed' });
    expect(prisma.rows[0].status).toBe('completed'); // 不覆寫已完成
    expect(queueRemove).not.toHaveBeenCalled();
  });

  it('does not overwrite a terminal partial job (M7-R5: partial is terminal)', async () => {
    const { service, prisma, queueRemove } = await buildHarness();
    // partial 為終態（T7.1：finishedAt + resultSnapshotId 已固化、BullMQ 標 completed、不自動 resume）。
    // cancel 不得把它覆寫成 canceled（否則終態被改、結果仍可讀＝自相矛盾，§6.8）。
    seedRow(prisma, { id: 'id-1', status: 'partial' });

    const out = await service.cancel('id-1', API_ACTOR);

    expect(out).toEqual({ status: 'partial' });
    expect(prisma.rows[0].status).toBe('partial'); // 不覆寫已固化的 partial
    expect(queueRemove).not.toHaveBeenCalled();
  });

  it('tolerates a queue removal failure (DB status is the authoritative signal)', async () => {
    const { service, prisma, queueRemove } = await buildHarness();
    queueRemove.mockRejectedValueOnce(new Error('job is locked'));
    seedRow(prisma, { id: 'id-1', status: 'running' });

    const out = await service.cancel('id-1', API_ACTOR);

    expect(out).toEqual({ status: 'canceled' });
    expect(prisma.rows[0].status).toBe('canceled');
  });

  it('scrubs secrets from the queue.remove warn log (NFR-5, M3-R6/#9)', async () => {
    const { service, prisma, queueRemove } = await buildHarness();
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // ioredis 連線錯誤可夾帶 REDIS_URL（含密碼）——警告日誌須遮罩。
    queueRemove.mockRejectedValueOnce(
      new Error('connect ECONNREFUSED redis://user:s3cr3t@redis:6379'),
    );
    seedRow(prisma, { id: 'id-1', status: 'running' });

    await service.cancel('id-1', API_ACTOR);

    const logged = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('s3cr3t');
    expect(logged).toContain('[Redacted]');
    warnSpy.mockRestore();
  });

  it('does not overwrite a job that completed mid-cancel (conditional updateMany, M3-R3)', async () => {
    const { service, prisma, queueRemove } = await buildHarness();
    seedRow(prisma, { id: 'id-1', status: 'completed' }); // 實際已 completed
    // race 視窗：pre-check 那一次 findUnique 讀到 running（過終態守門），但 updateMany 命中 0（實際 completed）。
    prisma.keywordAnalysis.findUnique.mockResolvedValueOnce({
      id: 'id-1',
      idempotencyKey: 'idem-id-1',
      status: 'running',
    });

    const out = await service.cancel('id-1', API_ACTOR);

    expect(out).toEqual({ status: 'completed' }); // 條件 updateMany 不覆寫終態
    expect(prisma.rows[0].status).toBe('completed');
    expect(queueRemove).not.toHaveBeenCalled();
  });
});
