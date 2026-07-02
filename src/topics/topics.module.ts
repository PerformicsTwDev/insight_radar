import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { azureConfig } from '../config/azure.config';
import { embeddingsConfig } from '../config/embeddings.config';
import { queueConfig } from '../config/queue.config';
import { topicsConfig } from '../config/topics.config';
import { ClusteringModule } from '../clustering/clustering.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { IntentModule } from '../intent/intent.module';
import { QueueModule } from '../queue/queue.module';
import { TOPICS_QUEUE } from '../queue/queue.constants';
import { SerpModule } from '../serp/serp.module';
import { TopicClusterProcessor } from './topic-cluster.processor';
import { TopicNamingService, TOPIC_NAMING_CONFIG } from './topic-naming.service';
import { TopicRepository } from './topic.repository';
import { TopicsController } from './topics.controller';
import { TopicsService } from './topics.service';

/**
 * 主題模組（T8.7 起 + T8.9 processor）。註冊 `topics` BullMQ queue（`@nestjs/bullmq`）+ {@link TopicClusterProcessor}
 * 編排 `load→serp→embed→cluster→represent→name→persist`。imports 各階段能力：{@link EmbeddingsModule}
 * （EmbeddingService）、{@link SerpModule}（SERP_PROVIDER）、{@link ClusteringModule}（CLUSTERING_PROVIDER）、
 * {@link IntentModule}（群命名複用 AzureOpenAiService）。TopicRepository（run 生命週期 + persist）在此提供。
 */
@Module({
  imports: [
    QueueModule,
    BullModule.registerQueue({ name: TOPICS_QUEUE }),
    EmbeddingsModule,
    SerpModule,
    ClusteringModule,
    IntentModule,
    ConfigModule.forFeature(topicsConfig),
    ConfigModule.forFeature(azureConfig),
    ConfigModule.forFeature(embeddingsConfig),
    ConfigModule.forFeature(queueConfig),
  ],
  controllers: [TopicsController],
  providers: [
    TopicNamingService,
    TopicRepository,
    TopicClusterProcessor,
    TopicsService,
    {
      provide: TOPIC_NAMING_CONFIG,
      useFactory: (
        topics: ConfigType<typeof topicsConfig>,
        azure: ConfigType<typeof azureConfig>,
      ) => ({ batchClusters: topics.llmBatchClusters, llmConcurrency: azure.llmConcurrency }),
      inject: [topicsConfig.KEY, azureConfig.KEY],
    },
  ],
  exports: [TopicNamingService, TopicRepository],
})
export class TopicsModule {}
