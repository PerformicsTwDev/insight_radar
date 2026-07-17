import { Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import { redisConfig } from '../config/redis.config';
import { JobEventsService, type QueueEventsLike } from './job-events.service';
import {
  JOURNEY_JOB_EVENTS,
  JOURNEY_JOB_EVENTS_CONNECTION,
  JOURNEY_QUEUE_EVENTS,
} from './journey-job-events.constants';
import { JOURNEY_QUEUE } from './queue.constants';
import { createBullConnection } from './queue.module';

/**
 * 連線生命週期擁有者（同 {@link TopicJobEventsModule}）：BullMQ `QueueEvents` 把注入連線視為 shared、close 只關
 * 其 duplicate → 本模組於 shutdown 收回注入的原始連線（NFR-8，防 idle socket / Jest hang）。
 */
@Injectable()
class JourneyJobEventsConnectionLifecycle implements OnModuleDestroy {
  constructor(@Inject(JOURNEY_JOB_EVENTS_CONNECTION) private readonly connection: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.connection.quit();
  }
}

/**
 * JourneyJobEventsModule（T12.6，FR-33/AC-33.6；平行 TopicJobEventsModule）：提供**單一** `QueueEvents('journey')`
 * （專用阻塞連線）+ 一個**複用 queue-agnostic `JobEventsService`** 的實例（綁 journey QueueEvents）。JourneyModule
 * 匯入本模組供 `@Sse` 消費 `forJob(runId)`。
 */
@Module({
  imports: [ConfigModule.forFeature(redisConfig)],
  providers: [
    {
      provide: JOURNEY_JOB_EVENTS_CONNECTION,
      useFactory: (config: ConfigType<typeof redisConfig>) => createBullConnection(config),
      inject: [redisConfig.KEY],
    },
    {
      provide: JOURNEY_QUEUE_EVENTS,
      useFactory: (connection: Redis) => new QueueEvents(JOURNEY_QUEUE, { connection }),
      inject: [JOURNEY_JOB_EVENTS_CONNECTION],
    },
    JourneyJobEventsConnectionLifecycle,
    {
      provide: JOURNEY_JOB_EVENTS,
      useFactory: (queueEvents: QueueEventsLike) => new JobEventsService(queueEvents),
      inject: [JOURNEY_QUEUE_EVENTS],
    },
  ],
  exports: [JOURNEY_JOB_EVENTS],
})
export class JourneyJobEventsModule {}
