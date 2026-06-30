import { Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import { redisConfig } from '../config/redis.config';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from './job-events.constants';
import { JobEventsService } from './job-events.service';
import { createBullConnection } from './queue.module';
import { KEYWORD_ANALYSIS_QUEUE } from './queue.constants';

/**
 * 連線生命週期擁有者：BullMQ `QueueEvents` 把**注入的**連線視為 `shared`、會 `.duplicate()` 出阻塞
 * 連線自用，且 `close()` 只關該 duplicate——**注入的原始連線不會被它 quit**。故由本模組負責在 shutdown
 * 收回原始 socket（NFR-8 graceful shutdown，並防 idle 重連 socket 卡住 event loop / Jest hang）。
 */
@Injectable()
class JobEventsConnectionLifecycle implements OnModuleDestroy {
  constructor(@Inject(JOB_EVENTS_CONNECTION) private readonly connection: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.connection.quit();
  }
}

/**
 * JobEventsModule（T3.8，FR-9）：提供**單一** `QueueEvents('keyword-analysis')`（專用阻塞式連線——
 * QueueEvents 以 XREAD 阻塞，不可共用 Queue 的連線）+ `JobEventsService`。獨立成模組讓 T3.1 的
 * `QueueModule` 測試不受影響。SSE（T3.9）匯入本模組消費 `JobEventsService.forJob`。
 */
@Module({
  imports: [ConfigModule.forFeature(redisConfig)],
  providers: [
    {
      provide: JOB_EVENTS_CONNECTION,
      useFactory: (config: ConfigType<typeof redisConfig>) => createBullConnection(config),
      inject: [redisConfig.KEY],
    },
    {
      provide: JOB_QUEUE_EVENTS,
      useFactory: (connection: Redis) => new QueueEvents(KEYWORD_ANALYSIS_QUEUE, { connection }),
      inject: [JOB_EVENTS_CONNECTION],
    },
    JobEventsConnectionLifecycle,
    JobEventsService,
  ],
  exports: [JobEventsService],
})
export class JobEventsModule {}
