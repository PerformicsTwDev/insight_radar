import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { embeddingsConfig } from '../config/embeddings.config';
import { EMBEDDING_PROVIDER } from './embedding-provider.port';
import { createGeminiEmbedClient, toGeminiEmbedConfig } from './gemini-embed.factory';
import { GEMINI_EMBED_CLIENT, GEMINI_EMBED_CONFIG } from './gemini-embed.port';
import { GeminiEmbeddingService } from './gemini-embedding.service';

/**
 * Embeddings 模組（T8.2c，FR-16/NFR-13）。由 embeddings config（已 Joi 驗證）建構 `@google/genai` client +
 * GeminiEmbedConfig（內部 provider），把 {@link GeminiEmbeddingService} 綁為 {@link EMBEDDING_PROVIDER} port。
 * 憑證（GEMINI_API_KEY）從 config 注入、不寫死、不入測試（測試以 `overrideProvider(GEMINI_EMBED_CLIENT)` 替換）。
 * client 建構邏輯抽至 factory（可單元測 option 對映）。
 */
@Module({
  imports: [ConfigModule.forFeature(embeddingsConfig)],
  providers: [
    GeminiEmbeddingService,
    {
      provide: GEMINI_EMBED_CLIENT,
      useFactory: (config: Parameters<typeof createGeminiEmbedClient>[0]) =>
        createGeminiEmbedClient(config),
      inject: [embeddingsConfig.KEY],
    },
    {
      provide: GEMINI_EMBED_CONFIG,
      useFactory: (config: Parameters<typeof toGeminiEmbedConfig>[0]) =>
        toGeminiEmbedConfig(config),
      inject: [embeddingsConfig.KEY],
    },
    { provide: EMBEDDING_PROVIDER, useExisting: GeminiEmbeddingService },
  ],
  exports: [EMBEDDING_PROVIDER, GeminiEmbeddingService],
})
export class EmbeddingsModule {}
