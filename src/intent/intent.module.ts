import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { azureConfig } from '../config/azure.config';
import { cacheConfig } from '../config/cache.config';
import { AzureOpenAiService } from './azure-openai.service';
import { createAzureOpenAiClient } from './azure-openai.factory';
import { IntentCache } from './intent-cache';
import {
  AZURE_OPENAI_CLIENT,
  AZURE_OPENAI_DEPLOYMENT,
  INTENT_LABELER,
} from './intent-labeler.port';
import { IntentService } from './intent.service';

/**
 * Intent 模組（T2.1）。由 azure config 建構 `AzureOpenAI` client（maxRetries=5），
 * 包成 `AZURE_OPENAI_CLIENT` 內部 provider；**只 export `AzureOpenAiService`**。
 * client 建構邏輯抽至 `createAzureOpenAiClient`（factory，可單元測 option 對映）。
 * `IntentCache`（T4.2）注入 `IntentService`：貼標前批查、命中省 LLM、miss 回寫。
 */
@Module({
  imports: [ConfigModule.forFeature(azureConfig), ConfigModule.forFeature(cacheConfig)],
  providers: [
    AzureOpenAiService,
    IntentCache,
    {
      provide: AZURE_OPENAI_CLIENT,
      useFactory: (config: Parameters<typeof createAzureOpenAiClient>[0]) =>
        createAzureOpenAiClient(config),
      inject: [azureConfig.KEY],
    },
    {
      provide: AZURE_OPENAI_DEPLOYMENT,
      useFactory: (config: Parameters<typeof createAzureOpenAiClient>[0]) => config.deployment,
      inject: [azureConfig.KEY],
    },
    IntentService,
    { provide: INTENT_LABELER, useExisting: AzureOpenAiService },
    {
      provide: 'INTENT_SERVICE_CONFIG',
      useFactory: (config: Parameters<typeof createAzureOpenAiClient>[0]) => ({
        batchSize: config.llmBatchSize,
        llmConcurrency: config.llmConcurrency,
      }),
      inject: [azureConfig.KEY],
    },
  ],
  // 也 export LLM 基礎 primitives（`INTENT_LABELER` port + 部署名 token），供 JourneyModule（T12.5）等
  // 複用 Azure 分類骨架的模組直接注入，避免各自重建 client/部署 factory。
  exports: [AzureOpenAiService, IntentService, INTENT_LABELER, AZURE_OPENAI_DEPLOYMENT],
})
export class IntentModule {}
