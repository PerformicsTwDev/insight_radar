import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { azureConfig } from '../config/azure.config';
import { topicsConfig } from '../config/topics.config';
import { IntentModule } from '../intent/intent.module';
import { TopicNamingService, TOPIC_NAMING_CONFIG } from './topic-naming.service';

/**
 * 主題模組（T8.7 起）。複用 {@link IntentModule} 的 `AzureOpenAiService`（LLM client，含 maxRetries）做群命名；
 * batch/並發由 topics + azure config 組裝成 {@link TOPIC_NAMING_CONFIG}。後續 T8.8/T8.9 於此掛持久化與 processor。
 */
@Module({
  imports: [
    IntentModule,
    ConfigModule.forFeature(topicsConfig),
    ConfigModule.forFeature(azureConfig),
  ],
  providers: [
    TopicNamingService,
    {
      provide: TOPIC_NAMING_CONFIG,
      useFactory: (
        topics: ConfigType<typeof topicsConfig>,
        azure: ConfigType<typeof azureConfig>,
      ) => ({ batchClusters: topics.llmBatchClusters, llmConcurrency: azure.llmConcurrency }),
      inject: [topicsConfig.KEY, azureConfig.KEY],
    },
  ],
  exports: [TopicNamingService],
})
export class TopicsModule {}
