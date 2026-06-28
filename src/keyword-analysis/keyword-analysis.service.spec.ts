import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CacheService } from '../cache/cache.service';
import { CacheNamespace } from '../cache/cache-namespace';
import { queueConfig } from '../config/queue.config';
import { PrismaService } from '../prisma/prisma.service';
import { KEYWORD_ANALYSIS_QUEUE } from '../queue/queue.constants';
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
      this.rows.push(args.data);
      return Promise.resolve(args.data);
    }),
    findUnique: jest.fn((args: { where: { idempotencyKey?: string } }) => {
      const row = this.rows.find((r) => r.idempotencyKey === args.where.idempotencyKey);
      return Promise.resolve(row ?? null);
    }),
    delete: jest.fn((args: { where: { id: string } }) => {
      this.deleted.push(args.where.id);
      const idx = this.rows.findIndex((r) => r.id === args.where.id);
      if (idx >= 0) this.rows.splice(idx, 1);
      return Promise.resolve(undefined);
    }),
  };
}

const QUEUE_CONFIG = {
  workerConcurrency: 5,
  jobAttempts: 5,
  jobBackoffMs: 3000,
  idempTtlMs: 86400000,
  jobTtlMs: 259200000,
};

interface Harness {
  service: KeywordAnalysisService;
  cache: FakeCache;
  prisma: FakePrisma;
  queueAdd: jest.Mock;
  queueGetJob: jest.Mock;
}

async function buildHarness(queueAdd?: jest.Mock): Promise<Harness> {
  const cache = new FakeCache();
  const prisma = new FakePrisma();
  const add = queueAdd ?? jest.fn().mockResolvedValue({ id: 'job-1' });
  const getJob = jest.fn();

  const moduleRef = await Test.createTestingModule({
    providers: [
      KeywordAnalysisService,
      { provide: getQueueToken(KEYWORD_ANALYSIS_QUEUE), useValue: { add, getJob } },
      { provide: CacheService, useValue: cache },
      { provide: PrismaService, useValue: prisma },
      { provide: queueConfig.KEY, useValue: QUEUE_CONFIG },
    ],
  }).compile();

  return {
    service: moduleRef.get(KeywordAnalysisService),
    cache,
    prisma,
    queueAdd: add,
    queueGetJob: getJob,
  };
}

const baseInput: CreateAnalysisInput = {
  seeds: ['Running Shoes', 'trail shoes'],
  params: { geo: 'TW', language: 'zh-TW', mode: 'expand', includeAdult: false },
};

describe('KeywordAnalysisService.create (T3.2, TC-10)', () => {
  it('enqueues a new job and persists a queued row + caches on first submit', async () => {
    const { service, queueAdd, prisma, cache } = await buildHarness();

    const { analysisId } = await service.create(baseInput);

    expect(analysisId).toMatch(/^[0-9a-f-]{36}$/);
    // queue.add: payload + idempotent jobId + retry policy
    expect(queueAdd).toHaveBeenCalledTimes(1);
    const [, payload, opts] = queueAdd.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { jobId: string; attempts: number; backoff: { type: string; delay: number } },
    ];
    expect(payload).toMatchObject({ analysisId, seeds: baseInput.seeds, params: baseInput.params });
    expect(opts).toEqual({
      jobId: analysisId,
      attempts: QUEUE_CONFIG.jobAttempts,
      backoff: { type: 'exponential', delay: QUEUE_CONFIG.jobBackoffMs },
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

    const first = await service.create(baseInput);
    const second = await service.create({
      seeds: ['  trail   shoes', 'RUNNING SHOES'],
      params: { includeAdult: false, mode: 'expand', language: 'zh-TW', geo: 'TW' },
    });

    expect(second.analysisId).toBe(first.analysisId);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(prisma.rows).toHaveLength(1);
  });

  it('recovers from a concurrent duplicate (cache miss + DB P2002) by returning the existing id', async () => {
    const { service, queueAdd, prisma, cache } = await buildHarness();

    // First submit creates the row but we wipe the idemp cache to simulate the racing
    // second request that missed the cache before the first one populated it.
    const first = await service.create(baseInput);
    for (const key of [...cache.store.keys()]) {
      if (key.startsWith(`${CacheNamespace.IDEMP}:`)) cache.store.delete(key);
    }

    const second = await service.create(baseInput);

    // Must return the existing id, NOT throw P2002, NOT enqueue/create a second row.
    expect(second.analysisId).toBe(first.analysisId);
    expect(prisma.rows).toHaveLength(1);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(prisma.keywordAnalysis.findUnique).toHaveBeenCalled();
  });

  it('does not orphan a queued row when enqueue fails (compensating delete)', async () => {
    const failingAdd = jest.fn().mockRejectedValue(new Error('redis down'));
    const { service, prisma, cache } = await buildHarness(failingAdd);

    await expect(service.create(baseInput)).rejects.toThrow('redis down');

    // Row must be rolled back so a retry isn't permanently wedged by P2002.
    expect(prisma.deleted).toHaveLength(1);
    expect(prisma.rows).toHaveLength(0);
    // idemp cache must NOT point at a job that was never enqueued.
    expect(cache.setCalls.some((c) => c.key.startsWith(`${CacheNamespace.IDEMP}:`))).toBe(false);
  });

  it('rethrows a non-unique DB error without enqueueing (no swallow)', async () => {
    const { service, prisma, queueAdd } = await buildHarness();
    prisma.keywordAnalysis.create.mockRejectedValueOnce(new Error('connection reset'));

    await expect(service.create(baseInput)).rejects.toThrow('connection reset');
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

    await expect(service.create(baseInput)).rejects.toBe(p2002);
  });

  it('produces DIFFERENT analysisId when params differ semantically (e.g. geo)', async () => {
    const { service } = await buildHarness();

    const a = await service.create(baseInput);
    const b = await service.create({
      seeds: baseInput.seeds,
      params: { ...baseInput.params, geo: 'US' },
    });

    expect(b.analysisId).not.toBe(a.analysisId);
  });
});

function fakeJob(overrides: { state: string; progress?: unknown; returnvalue?: unknown }): {
  getState: jest.Mock;
  progress: unknown;
  returnvalue: unknown;
} {
  return {
    getState: jest.fn().mockResolvedValue(overrides.state),
    progress: overrides.progress ?? {},
    returnvalue: overrides.returnvalue ?? null,
  };
}

describe('KeywordAnalysisService.getStatus (T3.4, TC-22)', () => {
  it('throws NotFound for an unknown analysisId', async () => {
    const { service, queueGetJob } = await buildHarness();
    queueGetJob.mockResolvedValue(undefined);

    await expect(service.getStatus('missing-id')).rejects.toBeInstanceOf(NotFoundException);
    expect(queueGetJob).toHaveBeenCalledWith('missing-id');
  });

  it('maps a waiting job to status=queued with its progress', async () => {
    const { service, queueGetJob } = await buildHarness();
    queueGetJob.mockResolvedValue(
      fakeJob({ state: 'waiting', progress: { phase: 'queued', percent: 0 } }),
    );

    const res = await service.getStatus('id-1');

    expect(res).toEqual({
      status: 'queued',
      progress: { phase: 'queued', percent: 0 },
      result: { resultSnapshotId: null, count: null },
    });
  });

  it('maps an active job to status=running with phase progress', async () => {
    const { service, queueGetJob } = await buildHarness();
    queueGetJob.mockResolvedValue(
      fakeJob({
        state: 'active',
        progress: { phase: 'intent', percent: 72, expanded: 1980, labeled: 1420, total: 1980 },
      }),
    );

    const res = await service.getStatus('id-1');

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

  it('maps a completed job to status=completed with resultSnapshotId + count from returnvalue', async () => {
    const { service, queueGetJob } = await buildHarness();
    queueGetJob.mockResolvedValue(
      fakeJob({
        state: 'completed',
        progress: { phase: 'done', percent: 100 },
        returnvalue: { resultSnapshotId: 'snap-1', count: 1980 },
      }),
    );

    const res = await service.getStatus('id-1');

    expect(res.status).toBe('completed');
    expect(res.result).toEqual({ resultSnapshotId: 'snap-1', count: 1980 });
  });

  it('maps a failed job to status=failed', async () => {
    const { service, queueGetJob } = await buildHarness();
    queueGetJob.mockResolvedValue(
      fakeJob({ state: 'failed', progress: { phase: 'fetch', percent: 40 } }),
    );

    const res = await service.getStatus('id-1');

    expect(res.status).toBe('failed');
    expect(res.result).toEqual({ resultSnapshotId: null, count: null });
  });

  it('defaults progress to a queued shape when the job has none yet', async () => {
    const { service, queueGetJob } = await buildHarness();
    queueGetJob.mockResolvedValue(fakeJob({ state: 'delayed', progress: undefined }));

    const res = await service.getStatus('id-1');

    expect(res.status).toBe('queued');
    expect(res.progress).toEqual({ phase: 'queued', percent: 0 });
  });
});
