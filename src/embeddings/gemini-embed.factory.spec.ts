import type { EmbedContentResponse } from '@google/genai';
import type { ConfigType } from '@nestjs/config';
import type { embeddingsConfig } from '../config/embeddings.config';
import {
  type GoogleGenAICtor,
  createGeminiEmbedClient,
  toGeminiEmbedConfig,
} from './gemini-embed.factory';
import type { GeminiEmbedClient } from './gemini-embed.port';

const CONFIG: ConfigType<typeof embeddingsConfig> = {
  apiKey: 'secret-key',
  model: 'gemini-embedding-001',
  taskType: 'CLUSTERING',
  dim: 3072,
  batchSize: 100,
  concurrency: 4,
  maxRetries: 5,
  backoffBaseMs: 500,
  schemaVersion: 'v1',
  cacheTtlMs: 5184000000,
};

describe('gemini-embed.factory (T8.2c)', () => {
  it('constructs the client with the config apiKey (injectable ctor, no real network)', () => {
    const seen: { apiKey: string }[] = [];
    const FakeCtor: GoogleGenAICtor = class implements GeminiEmbedClient {
      readonly models = {
        embedContent: (): Promise<EmbedContentResponse> => Promise.resolve({ embeddings: [] }),
      };
      constructor(options: { apiKey: string }) {
        seen.push(options);
      }
    };

    const client = createGeminiEmbedClient(CONFIG, FakeCtor);

    expect(seen).toEqual([{ apiKey: 'secret-key' }]);
    expect(client).toBeDefined();
  });

  it('defaults to the real GoogleGenAI ctor (lazy construction, no network)', () => {
    // 不傳 Ctor → 走預設 GoogleGenAI 分支；建構為 lazy（不發網路）→ 回一個具 models.embedContent 的 client。
    const client = createGeminiEmbedClient(CONFIG);
    expect(typeof client.models.embedContent).toBe('function');
  });

  it('toGeminiEmbedConfig maps embeddings config → adapter config (drops apiKey/schema/ttl)', () => {
    expect(toGeminiEmbedConfig(CONFIG)).toEqual({
      model: 'gemini-embedding-001',
      taskType: 'CLUSTERING',
      dim: 3072,
      batchSize: 100,
      concurrency: 4,
      maxRetries: 5,
      backoffBaseMs: 500,
    });
  });
});
