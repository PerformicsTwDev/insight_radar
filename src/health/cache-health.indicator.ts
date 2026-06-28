import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { CacheService } from '../cache';

/**
 * T0.7 red stub：讀依賴但一律回 down，讓 cache indicator spec 與 /health 整合測試（→503）轉紅。
 * green 階段補上 probe 寫讀邏輯。
 */
@Injectable()
export class CacheHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly cache: CacheService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    await this.cache.get<string>(this.cache.buildKey('health', 'probe'));
    return indicator.down({ message: 'not implemented (red stub)' });
  }
}
