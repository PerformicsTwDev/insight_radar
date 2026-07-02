import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { ConfigType } from '@nestjs/config';
import { CacheModule } from 'src/cache/cache.module';
import { CacheService } from 'src/cache/cache.service';
import type { embeddingsConfig } from 'src/config/embeddings.config';
import { EmbeddingCache } from 'src/embeddings/embedding-cache';
import { EmbeddingRepository } from 'src/embeddings/embedding.repository';
import { EmbeddingService, type EmbedItem } from 'src/embeddings/embedding.service';
import type { SerpContext } from 'src/embeddings/embedding.types';
import { PrismaModule, PrismaService } from 'src/prisma';

/**
 * TC-50（T8.2c · FR-16 · Testcontainers pgvector + 記憶體 Keyv 快取）：cache-first embedding。mget 只對 miss
 * 打 Gemini（命中省）；bump `EMBEDDING_SCHEMA_VERSION` → input_hash 變 → 整批失效重打；`input_hash` 含是否帶
 * SERP → SERP/純關鍵字互不污染。
 */
const DIM = 3072;

function vec(head: number): number[] {
  const arr = new Array<number>(DIM).fill(0);
  arr[head % DIM] = 1;
  return arr;
}

const BASE_CONFIG: ConfigType<typeof embeddingsConfig> = {
  apiKey: 'k',
  model: 'gemini-embedding-001',
  taskType: 'CLUSTERING',
  dim: DIM,
  batchSize: 100,
  concurrency: 4,
  maxRetries: 5,
  backoffBaseMs: 500,
  schemaVersion: 'v1',
  cacheTtlMs: 60000,
};

function item(normalizedText: string, serp?: SerpContext): EmbedItem {
  return { geo: 'US', language: 'en', normalizedText, serp };
}

describe('EmbeddingService cache-first (integration · Testcontainers pgvector + Keyv, TC-50)', () => {
  let cacheService: CacheService;
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let provider: { embed: jest.Mock };
  let cache: EmbeddingCache;
  let repository: EmbeddingRepository;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, CacheModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    cacheService = app.get(CacheService);
    prisma = app.get(PrismaService);
    close = () => app.close();
    repository = new EmbeddingRepository(prisma);
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(() => {
    provider = {
      embed: jest.fn((texts: string[]) => Promise.resolve(texts.map((_t, i) => vec(i)))),
    };
    cache = new EmbeddingCache(cacheService, BASE_CONFIG);
  });

  afterEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM keyword_embeddings');
    await cacheService.clear(); // 隔離：清快取避免跨測試假命中
  });

  function serviceWith(config: ConfigType<typeof embeddingsConfig>): EmbeddingService {
    return new EmbeddingService(provider, cache, repository, config);
  }

  it('embeds on first call, then serves the cache on the second (mget only hits misses → 省 Gemini)', async () => {
    const service = serviceWith(BASE_CONFIG);
    const items = [item('coffee'), item('latte')];

    await service.embed(items);
    await service.embed(items); // 全命中

    expect(provider.embed).toHaveBeenCalledTimes(1); // 只有第一次打 Gemini
  });

  it('bumping EMBEDDING_SCHEMA_VERSION invalidates the whole batch (input_hash changes → re-embed)', async () => {
    await serviceWith(BASE_CONFIG).embed([item('coffee')]); // v1 → 打一次 + 快取
    provider.embed.mockClear();

    await serviceWith({ ...BASE_CONFIG, schemaVersion: 'v2' }).embed([item('coffee')]); // v2 → 不同 hash → miss

    expect(provider.embed).toHaveBeenCalledTimes(1); // 重打（整批失效）
  });

  it('does not let a with-SERP embedding pollute the pure-keyword cache (input_hash includes SERP)', async () => {
    const serp: SerpContext = { organic: [{ title: 'Best coffee', snippet: 'top picks' }] };
    await serviceWith(BASE_CONFIG).embed([item('coffee')]); // 純關鍵字 → 快取
    provider.embed.mockClear();

    await serviceWith(BASE_CONFIG).embed([item('coffee', serp)]); // 帶 SERP → 不同 hash → miss

    expect(provider.embed).toHaveBeenCalledTimes(1); // 不命中純關鍵字快取
  });

  it('persists miss vectors to pgvector (durable store for clustering)', async () => {
    await serviceWith(BASE_CONFIG).embed([item('coffee')]);

    const stored = await repository.findVectors({
      geo: 'US',
      language: 'en',
      model: 'gemini-embedding-001',
      taskType: 'CLUSTERING',
      dim: DIM,
      normalizedTexts: ['coffee'],
    });
    expect(stored.get('coffee')).toHaveLength(DIM);
  });
});
