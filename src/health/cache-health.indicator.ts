import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { CacheService } from '../cache';

/**
 * 快取（Redis/Keyv）健康探針（T0.7）。寫一個短 TTL probe key 再讀回驗證；
 * 失敗（連線/不一致）回 down。prod 對應真實 Redis、test 對應記憶體 Keyv。
 */
@Injectable()
export class CacheHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly cache: CacheService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      const probeKey = this.cache.buildKey('health', 'probe');
      await this.cache.set(probeKey, 'ok', 1000);
      const value = await this.cache.get<string>(probeKey);
      if (value !== 'ok') {
        return indicator.down({ message: 'cache probe value mismatch' });
      }
      return indicator.up();
    } catch (error) {
      return indicator.down({ message: error instanceof Error ? error.message : 'cache error' });
    }
  }
}
