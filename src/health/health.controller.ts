import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../common/public.decorator';
import { PrismaService } from '../prisma';
import { CacheHealthIndicator } from './cache-health.indicator';

/**
 * 健康檢查（T0.7）。掛在 `GET /health`（排除於 `/api/v1` 前綴外，NFR-10）、`@Public`（免認證，TC-25）。
 * 回報 DB（Prisma `SELECT 1`）與 Cache（Redis/Keyv probe）狀態；任一 down → terminus 回 503。
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly cacheIndicator: CacheHealthIndicator,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma),
      () => this.cacheIndicator.isHealthy('cache'),
    ]);
  }
}
