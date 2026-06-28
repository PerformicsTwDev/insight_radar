import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { CacheService } from '../cache/cache.service';
import { CacheNamespace } from '../cache/cache-namespace';
import { queueConfig } from '../config/queue.config';
import { PrismaService } from '../prisma/prisma.service';
import { KEYWORD_ANALYSIS_QUEUE } from '../queue/queue.constants';
import { KeywordAnalysisService } from './keyword-analysis.service';
import type { CreateAnalysisInput } from './keyword-analysis.service';

/** in-memory CacheService 替身（不連 Redis），保留信封語意（miss→undefined）。 */
class FakeCache {
  private readonly store = new Map<string, unknown>();
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
  queueAdd: jest.Mock;
  created: Array<Record<string, unknown>>;
}

async function buildHarness(): Promise<Harness> {
  const cache = new FakeCache();
  const queueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    keywordAnalysis: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return Promise.resolve(args.data);
      }),
    },
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      KeywordAnalysisService,
      { provide: getQueueToken(KEYWORD_ANALYSIS_QUEUE), useValue: { add: queueAdd } },
      { provide: CacheService, useValue: cache },
      { provide: PrismaService, useValue: prisma },
      { provide: queueConfig.KEY, useValue: QUEUE_CONFIG },
    ],
  }).compile();

  return {
    service: moduleRef.get(KeywordAnalysisService),
    cache,
    queueAdd,
    created,
  };
}

const baseInput: CreateAnalysisInput = {
  seeds: ['Running Shoes', 'trail shoes'],
  params: { geo: 'TW', language: 'zh-TW', mode: 'expand', includeAdult: false },
};

describe('KeywordAnalysisService.create (T3.2, TC-10)', () => {
  it('enqueues a new job and returns an analysisId on first submit', async () => {
    const { service, queueAdd, created, cache } = await buildHarness();

    const { analysisId } = await service.create(baseInput);

    expect(analysisId).toMatch(/^[0-9a-f-]{36}$/);
    // queue.add called once with payload carrying analysisId + seeds + params
    expect(queueAdd).toHaveBeenCalledTimes(1);
    const [, payload] = queueAdd.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload).toMatchObject({
      analysisId,
      seeds: baseInput.seeds,
      params: baseInput.params,
    });
    // KeywordAnalysis row written with status 'queued'
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ id: analysisId, status: 'queued' });
    // idemp + job: cache entries written
    const idempKeys = cache.setCalls.filter((c) => c.key.startsWith(`${CacheNamespace.IDEMP}:`));
    expect(idempKeys).toHaveLength(1);
    expect(idempKeys[0].value).toBe(analysisId);
    expect(idempKeys[0].ttlMs).toBe(QUEUE_CONFIG.idempTtlMs);
  });

  it('returns the SAME analysisId for semantically-equal submits (seed order + param key order differ)', async () => {
    const { service, queueAdd, created } = await buildHarness();

    const first = await service.create(baseInput);
    const second = await service.create({
      // seeds reordered + different surface case/whitespace, params key order shuffled
      seeds: ['  trail   shoes', 'RUNNING SHOES'],
      params: { includeAdult: false, mode: 'expand', language: 'zh-TW', geo: 'TW' },
    });

    expect(second.analysisId).toBe(first.analysisId);
    // second submit must NOT enqueue or create again (idempotent hit)
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
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
