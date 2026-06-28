import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigType } from '@nestjs/config';
import IORedis, { type Redis } from 'ioredis';
import { redisConfig } from '../config/redis.config';
import { BULL_CONNECTION, KEYWORD_ANALYSIS_QUEUE } from './queue.constants';

/**
 * 由 config 建立 BullMQ 的 Redis 連線（`maxRetriesPerRequest:null` 為 BullMQ 要求）。
 * 抽成具名 provider（{@link BULL_CONNECTION}）讓測試可 override 成 ioredis-mock，不連真 Redis。
 */
function createBullConnection(config: ConfigType<typeof redisConfig>): Redis {
  return new IORedis(config.url, { maxRetriesPerRequest: null });
}

/**
 * Queue 模組（T3.1，FR-1/NFR-8）。`BullModule.forRootAsync` 注入共享連線 +
 * `registerQueue('keyword-analysis')`。
 *
 * worker concurrency 在 processor（T3.5）以 config 設定，**不**用 BullMQ worker `limiter` 做 Ads QPS
 * （ADR-0001 / T3.6 集中式 per-CID 限流器）。
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule.forFeature(redisConfig)],
      useFactory: (connection: Redis) => ({ connection }),
      inject: [BULL_CONNECTION],
      extraProviders: [
        {
          provide: BULL_CONNECTION,
          useFactory: createBullConnection,
          inject: [redisConfig.KEY],
        },
      ],
    }),
    BullModule.registerQueue({ name: KEYWORD_ANALYSIS_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
