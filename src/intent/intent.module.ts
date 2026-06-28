import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { azureConfig } from '../config/azure.config';
import { AzureOpenAiService } from './azure-openai.service';
import { createAzureOpenAiClient } from './azure-openai.factory';
import { AZURE_OPENAI_CLIENT, AZURE_OPENAI_DEPLOYMENT } from './intent-labeler.port';

/**
 * Intent 模組（T2.1）。由 azure config 建構 `AzureOpenAI` client（maxRetries=5），
 * 包成 `AZURE_OPENAI_CLIENT` 內部 provider；**只 export `AzureOpenAiService`**。
 * client 建構邏輯抽至 `createAzureOpenAiClient`（factory，可單元測 option 對映）。
 */
@Module({
  imports: [ConfigModule.forFeature(azureConfig)],
  providers: [
    AzureOpenAiService,
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
  ],
  exports: [AzureOpenAiService],
})
export class IntentModule {}
