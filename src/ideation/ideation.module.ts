import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { azureConfig } from '../config/azure.config';
import { IntentModule } from '../intent/intent.module';
import { IdeationController } from './ideation.controller';
import { IDEATION_CONFIG, IdeationService } from './ideation.service';

/**
 * AI 輔助發想模組（T12.10，FR-35）。imports `IntentModule`（複用 `AzureOpenAiService` 單次同步小完成）。
 * `IDEATION_CONFIG` 自 azure config 的 `ideationMaxKeywords` 組裝。`IdeationController` 為純委派 shell + 同步 200
 * （LLM 失敗→502 由 `IdeationGenerationFilter`）。**無 queue/DB**（無狀態生成）、無 owner-scope（standalone endpoint）。
 */
@Module({
  imports: [IntentModule, ConfigModule.forFeature(azureConfig)],
  controllers: [IdeationController],
  providers: [
    IdeationService,
    {
      provide: IDEATION_CONFIG,
      useFactory: (azure: ConfigType<typeof azureConfig>) => ({
        maxKeywords: azure.ideationMaxKeywords,
      }),
      inject: [azureConfig.KEY],
    },
  ],
  exports: [IdeationService],
})
export class IdeationModule {}
