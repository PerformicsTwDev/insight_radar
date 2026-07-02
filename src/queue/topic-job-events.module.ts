import { Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import { redisConfig } from '../config/redis.config';
import { JobEventsService, type QueueEventsLike } from './job-events.service';
import { createBullConnection } from './queue.module';
import { TOPICS_QUEUE } from './queue.constants';
import {
  TOPIC_JOB_EVENTS,
  TOPIC_JOB_EVENTS_CONNECTION,
  TOPIC_QUEUE_EVENTS,
} from './topic-job-events.constants';

/**
 * 連線生命週期擁有者（同 {@link JobEventsModule}）：BullMQ `QueueEvents` 把注入連線視為 shared、close 只關
 * 其 duplicate，注入的原始連線不會被 quit → 本模組於 shutdown 收回（NFR-8，防 idle socket / Jest hang）。
 */
@Injectable()
class TopicJobEventsConnectionLifecycle implements OnModuleDestroy {
  constructor(@Inject(TOPIC_JOB_EVENTS_CONNECTION) private readonly connection: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.connection.quit();
  }
}

/**
 * TopicJobEventsModule（T8.10b，FR-18）：提供**單一** `QueueEvents('topics')`（專用阻塞連線）+ 一個
 * **複用既有 queue-agnostic `JobEventsService`** 的實例（`useFactory` 注入 topics QueueEvents）。TopicsModule
 * 匯入本模組供 `@Sse` 消費 `forJob(runId)`。與 keyword-analysis 的 `JobEventsModule` 平行、互不影響。
 */
@Module({
  imports: [ConfigModule.forFeature(redisConfig)],
  providers: [
    {
      provide: TOPIC_JOB_EVENTS_CONNECTION,
      useFactory: (config: ConfigType<typeof redisConfig>) => createBullConnection(config),
      inject: [redisConfig.KEY],
    },
    {
      provide: TOPIC_QUEUE_EVENTS,
      useFactory: (connection: Redis) => new QueueEvents(TOPICS_QUEUE, { connection }),
      inject: [TOPIC_JOB_EVENTS_CONNECTION],
    },
    TopicJobEventsConnectionLifecycle,
    {
      provide: TOPIC_JOB_EVENTS,
      useFactory: (queueEvents: QueueEventsLike) => new JobEventsService(queueEvents),
      inject: [TOPIC_QUEUE_EVENTS],
    },
  ],
  exports: [TOPIC_JOB_EVENTS],
})
export class TopicJobEventsModule {}
