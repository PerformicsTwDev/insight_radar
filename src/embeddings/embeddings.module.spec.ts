import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { EmbedContentResponse } from '@google/genai';
import { embeddingsConfig } from '../config/embeddings.config';
import { EMBEDDING_PROVIDER, type EmbeddingProvider } from './embedding-provider.port';
import { EmbeddingsModule } from './embeddings.module';
import {
  GEMINI_EMBED_CLIENT,
  GEMINI_EMBED_CONFIG,
  type GeminiEmbedClient,
} from './gemini-embed.port';
import { GeminiEmbeddingService } from './gemini-embedding.service';

const ENV: Record<string, string> = {
  GEMINI_API_KEY: 'gkey',
  GEMINI_EMBEDDING_DIM: '3072',
  GEMINI_EMBEDDING_MODEL: 'gemini-embedding-001',
  GEMINI_EMBEDDING_TASK_TYPE: 'CLUSTERING',
  GEMINI_EMBEDDING_BATCH_SIZE: '100',
  GEMINI_EMBEDDING_CONCURRENCY: '4',
  GEMINI_EMBEDDING_MAX_RETRIES: '5',
  GEMINI_EMBEDDING_BACKOFF_BASE_MS: '500',
  EMBEDDING_SCHEMA_VERSION: 'v1',
  CACHE_TTL_EMBEDDING_MS: '5184000000',
};

/** fake client → 不建構真 GoogleGenAI（避免依賴 SDK 建構行為 / 網路）。 */
const fakeClient: GeminiEmbedClient = {
  models: {
    embedContent: (): Promise<EmbedContentResponse> => Promise.resolve({ embeddings: [] }),
  },
};

describe('EmbeddingsModule (T8.2c wiring)', () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original, ...ENV };
  });
  afterEach(() => {
    process.env = original;
  });

  it('wires EMBEDDING_PROVIDER to GeminiEmbeddingService with a config-sourced GEMINI_EMBED_CONFIG', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ load: [embeddingsConfig], ignoreEnvFile: true }),
        EmbeddingsModule,
      ],
    })
      .overrideProvider(GEMINI_EMBED_CLIENT)
      .useValue(fakeClient)
      .compile();

    const provider = moduleRef.get<EmbeddingProvider>(EMBEDDING_PROVIDER);
    expect(provider).toBeInstanceOf(GeminiEmbeddingService);

    // GEMINI_EMBED_CONFIG 由 embeddings config 映射（非寫死）。
    expect(moduleRef.get(GEMINI_EMBED_CONFIG)).toEqual({
      model: 'gemini-embedding-001',
      taskType: 'CLUSTERING',
      dim: 3072,
      batchSize: 100,
      concurrency: 4,
      maxRetries: 5,
      backoffBaseMs: 500,
    });

    await moduleRef.close();
  });
});
