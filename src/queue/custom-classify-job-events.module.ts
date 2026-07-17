import { Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import { redisConfig } from '../config/redis.config';
import {
  CUSTOM_CLASSIFY_JOB_EVENTS,
  CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION,
  CUSTOM_CLASSIFY_QUEUE_EVENTS,
} from './custom-classify-job-events.constants';
import { JobEventsService, type QueueEventsLike } from './job-events.service';
import { CUSTOM_CLASSIFY_QUEUE } from './queue.constants';
import { createBullConnection } from './queue.module';

/**
 * 連線生命週期擁有者（同 {@link JourneyJobEventsModule}）：BullMQ `QueueEvents` 把注入連線視為 shared、close 只關
 * 其 duplicate → 本模組於 shutdown 收回注入的原始連線（NFR-8，防 idle socket / Jest hang）。
 */
@Injectable()
class CustomClassifyJobEventsConnectionLifecycle implements OnModuleDestroy {
  constructor(@Inject(CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION) private readonly connection: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.connection.quit();
  }
}

/**
 * CustomClassifyJobEventsModule（T12.8，FR-34；平行 JourneyJobEventsModule）：提供**單一**
 * `QueueEvents('custom-classify')`（專用阻塞連線）+ 一個**複用 queue-agnostic `JobEventsService`** 的實例
 * （綁 custom-classify QueueEvents）。CustomClassifyModule 匯入本模組供 `@Sse` 消費 `forJob(runId)`。
 */
@Module({
  imports: [ConfigModule.forFeature(redisConfig)],
  providers: [
    {
      provide: CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION,
      useFactory: (config: ConfigType<typeof redisConfig>) => createBullConnection(config),
      inject: [redisConfig.KEY],
    },
    {
      provide: CUSTOM_CLASSIFY_QUEUE_EVENTS,
      useFactory: (connection: Redis) => new QueueEvents(CUSTOM_CLASSIFY_QUEUE, { connection }),
      inject: [CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION],
    },
    CustomClassifyJobEventsConnectionLifecycle,
    {
      provide: CUSTOM_CLASSIFY_JOB_EVENTS,
      useFactory: (queueEvents: QueueEventsLike) => new JobEventsService(queueEvents),
      inject: [CUSTOM_CLASSIFY_QUEUE_EVENTS],
    },
  ],
  exports: [CUSTOM_CLASSIFY_JOB_EVENTS],
})
export class CustomClassifyJobEventsModule {}
