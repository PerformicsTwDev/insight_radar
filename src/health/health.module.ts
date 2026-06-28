import { Module } from '@nestjs/common';
import { PrismaHealthIndicator, TerminusModule } from '@nestjs/terminus';
import { CacheHealthIndicator } from './cache-health.indicator';
import { HealthController } from './health.controller';

/**
 * 健康檢查模組（T0.7）。`TerminusModule` 提供 HealthCheckService/HealthIndicatorService；
 * DB 用內建 `PrismaHealthIndicator`、Cache 用自訂 `CacheHealthIndicator`。
 * 需要全域 `PrismaService`（PrismaModule @Global）與 `CacheService`（CacheModule @Global）。
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, CacheHealthIndicator],
})
export class HealthModule {}
