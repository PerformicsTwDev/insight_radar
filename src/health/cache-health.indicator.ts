import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { CacheService } from '../cache';

/**
 * 快取（Redis/Keyv）健康探針（T0.7）。寫一個短 TTL probe key 再讀回驗證；
 * 失敗（連線/不一致）回 down。prod 對應真實 Redis、test 對應記憶體 Keyv。
 *
 * `/health` 為**公開未認證**端點，故 down detail 只回通用訊息、內部錯誤進 server log（NFR-5 不洩漏細節）。
 */
@Injectable()
export class CacheHealthIndicator {
  private readonly logger = new Logger(CacheHealthIndicator.name);

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
        this.logger.warn('Cache health probe value mismatch');
        return indicator.down({ message: 'cache unavailable' });
      }
      return indicator.up();
    } catch (error) {
      this.logger.error(
        'Cache health probe failed',
        error instanceof Error ? error.stack : String(error),
      );
      return indicator.down({ message: 'cache unavailable' });
    }
  }
}
