import { Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigType } from '@nestjs/config';
import IORedis, { type Redis } from 'ioredis';
import { redisConfig } from '../config/redis.config';
import { BULL_CONNECTION, KEYWORD_ANALYSIS_QUEUE } from './queue.constants';

type RedisCtor = new (url: string, opts: { maxRetriesPerRequest: null }) => Redis;

/**
 * 由 config 建立 BullMQ 的 Redis 連線（`maxRetriesPerRequest:null` 為 BullMQ 阻塞命令的要求）。
 * 抽成具名 provider（{@link BULL_CONNECTION}）讓測試可 override 成 ioredis-mock，不連真 Redis。
 * `Ctor` 預設為真 IORedis，測試可注入假建構式驗證 production 連線參數。
 */
export function createBullConnection(
  config: ConfigType<typeof redisConfig>,
  Ctor: RedisCtor = IORedis,
): Redis {
  return new Ctor(config.url, { maxRetriesPerRequest: null });
}

/**
 * 連線生命週期擁有者：BullMQ 把「注入的」連線視為 `shared` 而**不會**在 close 時 quit，
 * 故由本模組負責在 shutdown 收回 socket（NFR-8 graceful shutdown，並防 Jest hang）。
 */
@Injectable()
class BullConnectionLifecycle implements OnModuleDestroy {
  constructor(@Inject(BULL_CONNECTION) private readonly connection: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.connection.quit();
  }
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
          useFactory: (config: ConfigType<typeof redisConfig>) => createBullConnection(config),
          inject: [redisConfig.KEY],
        },
        BullConnectionLifecycle,
      ],
    }),
    BullModule.registerQueue({ name: KEYWORD_ANALYSIS_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
