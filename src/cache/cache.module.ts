import { createKeyv } from '@keyv/redis';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Keyv from 'keyv';
import { CacheService } from './cache.service';

/**
 * 建立 cache store：測試用記憶體 Keyv（免真實 Redis）；其餘用 `@keyv/redis`
 * （cache-manager **v6** Keyv-based，**非**舊 cache-manager-redis-store）。
 */
function buildStore(config: ConfigService): Keyv {
  if (process.env.NODE_ENV === 'test') {
    return new Keyv();
  }
  return createKeyv(config.getOrThrow<string>('redis.url'));
}

@Global()
@Module({
  imports: [
    NestCacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ stores: [buildStore(config)] }),
    }),
  ],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
