import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { azureConfig } from '../config/azure.config';
import { IntentModule } from '../intent/intent.module';
import { KeywordsModule } from '../keywords/keywords.module';
import { CustomClassifyController } from './custom-classify.controller';
import { CUSTOM_CLASSIFY_CONFIG, CustomClassifyService } from './custom-classify.service';

/**
 * 自訂分類**階段一**模組（T12.7 service + HTTP 端點，FR-34）。imports `IntentModule`（複用
 * `AzureOpenAiService`）、`KeywordsModule`（複用 `SnapshotQueryService`：owner-scoped snapshot 解析）；
 * `PrismaService`（載樣本 + 落 `custom_classifications`）為全域。`CUSTOM_CLASSIFY_CONFIG` 自 azure config 的
 * `customClassifyMaxLabels` 組裝（標籤數量上限；後處理截斷）。`CustomClassifyController` 為純委派 shell
 * （狀態映射沿用既有單點；LLM 失敗→502 由 `CustomClassifyGenerationFilter`）。
 */
@Module({
  imports: [IntentModule, KeywordsModule, ConfigModule.forFeature(azureConfig)],
  controllers: [CustomClassifyController],
  providers: [
    CustomClassifyService,
    {
      provide: CUSTOM_CLASSIFY_CONFIG,
      useFactory: (azure: ConfigType<typeof azureConfig>) => ({
        maxLabels: azure.customClassifyMaxLabels,
      }),
      inject: [azureConfig.KEY],
    },
  ],
  exports: [CustomClassifyService],
})
export class CustomClassifyModule {}
