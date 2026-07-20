import { Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import { redisConfig } from '../config/redis.config';
import {
  AI_SEARCH_JOB_EVENTS,
  AI_SEARCH_JOB_EVENTS_CONNECTION,
  AI_SEARCH_QUEUE_EVENTS,
} from './ai-search-job-events.constants';
import { JobEventsService, type QueueEventsLike } from './job-events.service';
import { AI_SEARCH_QUEUE } from './queue.constants';
import { createBullConnection } from './queue.module';

/**
 * 連線生命週期擁有者（同 {@link JourneyJobEventsModule}）：BullMQ `QueueEvents` 把注入連線視為 shared、close 只關
 * 其 duplicate → 本模組於 shutdown 收回注入的原始連線（NFR-8，防 idle socket / Jest hang）。
 */
@Injectable()
class AiSearchJobEventsConnectionLifecycle implements OnModuleDestroy {
  constructor(@Inject(AI_SEARCH_JOB_EVENTS_CONNECTION) private readonly connection: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.connection.quit();
  }
}

/**
 * AiSearchJobEventsModule（T14.6，FR-41/AC-41.1；平行 JourneyJobEventsModule）：提供**單一**
 * `QueueEvents('ai-search')`（專用阻塞連線）+ 一個**複用 queue-agnostic `JobEventsService`** 的實例（綁 ai-search
 * QueueEvents）。AiSearchModule 匯入本模組供 `@Sse` 消費 `forJob(runId)`（heartbeat + inclusive takeWhile）。
 */
@Module({
  imports: [ConfigModule.forFeature(redisConfig)],
  providers: [
    {
      provide: AI_SEARCH_JOB_EVENTS_CONNECTION,
      useFactory: (config: ConfigType<typeof redisConfig>) => createBullConnection(config),
      inject: [redisConfig.KEY],
    },
    {
      provide: AI_SEARCH_QUEUE_EVENTS,
      useFactory: (connection: Redis) => new QueueEvents(AI_SEARCH_QUEUE, { connection }),
      inject: [AI_SEARCH_JOB_EVENTS_CONNECTION],
    },
    AiSearchJobEventsConnectionLifecycle,
    {
      provide: AI_SEARCH_JOB_EVENTS,
      useFactory: (queueEvents: QueueEventsLike) => new JobEventsService(queueEvents),
      inject: [AI_SEARCH_QUEUE_EVENTS],
    },
  ],
  exports: [AI_SEARCH_JOB_EVENTS],
})
export class AiSearchJobEventsModule {}
