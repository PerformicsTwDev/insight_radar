import type { ConfigType } from '@nestjs/config';
import type { embeddingsConfig } from '../config/embeddings.config';
import type { EmbeddingCache } from './embedding-cache';
import { EmbeddingService, type EmbedItem } from './embedding.service';
import type { EmbeddingRecord, EmbeddingRepository } from './embedding.repository';

const CONFIG: ConfigType<typeof embeddingsConfig> = {
  apiKey: 'k',
  model: 'gemini-embedding-001',
  taskType: 'CLUSTERING',
  dim: 3072,
  batchSize: 100,
  concurrency: 4,
  maxRetries: 5,
  backoffBaseMs: 500,
  schemaVersion: 'v1',
  cacheTtlMs: 1,
};

function item(normalizedText: string): EmbedItem {
  return { geo: 'US', language: 'en', normalizedText };
}

interface Harness {
  service: EmbeddingService;
  provider: { embed: jest.Mock<Promise<number[][]>, [string[]]> };
  cache: {
    mget: jest.Mock<Promise<(number[] | undefined)[]>, [string[]]>;
    mset: jest.Mock<Promise<void>, [unknown]>;
  };
  repository: { upsertMany: jest.Mock<Promise<void>, [EmbeddingRecord[]]> };
}

function buildHarness(cachedReturn: (number[] | undefined)[]): Harness {
  const provider = {
    embed: jest.fn<Promise<number[][]>, [string[]]>((texts) =>
      Promise.resolve(texts.map((_t, i) => [i + 1])),
    ),
  };
  const cache = {
    mget: jest.fn<Promise<(number[] | undefined)[]>, [string[]]>().mockResolvedValue(cachedReturn),
    mset: jest.fn<Promise<void>, [unknown]>().mockResolvedValue(undefined),
  };
  const repository = {
    upsertMany: jest.fn<Promise<void>, [EmbeddingRecord[]]>().mockResolvedValue(undefined),
  };
  // EmbeddingProvider 為介面 → typed mock 直接可指派；EmbeddingCache/Repository 為 class（含 private）→ 需轉型。
  const service = new EmbeddingService(
    provider,
    cache as unknown as EmbeddingCache,
    repository as unknown as EmbeddingRepository,
    CONFIG,
  );
  return { service, provider, cache, repository };
}

describe('EmbeddingService cache-first (T8.2c / TC-50)', () => {
  it('calls the provider only for cache misses and writes them to repo + cache', async () => {
    const { service, provider, cache, repository } = buildHarness([undefined, undefined]);

    const out = await service.embed([item('a'), item('b')]);

    expect(provider.embed).toHaveBeenCalledTimes(1);
    expect(provider.embed.mock.calls[0][0]).toHaveLength(2); // 兩者皆 miss
    expect(repository.upsertMany).toHaveBeenCalledTimes(1);
    expect(repository.upsertMany.mock.calls[0][0]).toHaveLength(2);
    expect(cache.mset).toHaveBeenCalledTimes(1);
    expect(out).toEqual([[1], [2]]); // provider 回值對齊
  });

  it('does not call the provider when every input is cached (省 Gemini)', async () => {
    const { service, provider, repository, cache } = buildHarness([[7], [8]]);

    const out = await service.embed([item('a'), item('b')]);

    expect(provider.embed).not.toHaveBeenCalled();
    expect(repository.upsertMany).not.toHaveBeenCalled();
    expect(cache.mset).not.toHaveBeenCalled();
    expect(out).toEqual([[7], [8]]); // 全用快取
  });

  it('embeds only the misses and keeps the result aligned with input order (partial hit)', async () => {
    const { service, provider, repository } = buildHarness([[7], undefined, [9]]); // 只有 b miss

    const out = await service.embed([item('a'), item('b'), item('c')]);

    expect(provider.embed).toHaveBeenCalledTimes(1);
    expect(provider.embed.mock.calls[0][0]).toHaveLength(1); // 只送 b
    expect(repository.upsertMany.mock.calls[0][0][0].normalizedText).toBe('b');
    expect(out).toEqual([[7], [1], [9]]); // a/c 用快取、b 用 provider（[1]）、順序對齊
  });

  it('returns [] for no items without touching cache/provider', async () => {
    const { service, provider, cache } = buildHarness([]);
    expect(await service.embed([])).toEqual([]);
    expect(cache.mget).not.toHaveBeenCalled();
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it('passes model/taskType/dim + input_hash into the repository records', async () => {
    const { service, repository } = buildHarness([undefined]);
    await service.embed([item('coffee')]);
    const record = repository.upsertMany.mock.calls[0][0][0];
    expect(record).toMatchObject({
      geo: 'US',
      language: 'en',
      normalizedText: 'coffee',
      model: 'gemini-embedding-001',
      taskType: 'CLUSTERING',
      dim: 3072,
    });
    expect(record.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
