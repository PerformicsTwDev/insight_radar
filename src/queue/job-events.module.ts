import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { QueueEvents } from 'bullmq';
import { redisConfig } from '../config/redis.config';
import { JOB_QUEUE_EVENTS } from './job-events.constants';
import { JobEventsService } from './job-events.service';
import { createBullConnection } from './queue.module';
import { KEYWORD_ANALYSIS_QUEUE } from './queue.constants';

/**
 * JobEventsModule（T3.8，FR-9）：提供**單一** `QueueEvents('keyword-analysis')`（專用的、阻塞式
 * Redis 連線——QueueEvents 以 XREAD 阻塞，不可共用 Queue 的連線）+ `JobEventsService`。獨立成模組
 * 讓 T3.1 的 `QueueModule` 測試不受影響。SSE（T3.9）匯入本模組消費 `JobEventsService.forJob`。
 */
@Module({
  imports: [ConfigModule.forFeature(redisConfig)],
  providers: [
    {
      provide: JOB_QUEUE_EVENTS,
      useFactory: (config: ConfigType<typeof redisConfig>) =>
        new QueueEvents(KEYWORD_ANALYSIS_QUEUE, { connection: createBullConnection(config) }),
      inject: [redisConfig.KEY],
    },
    JobEventsService,
  ],
  exports: [JobEventsService],
})
export class JobEventsModule {}
