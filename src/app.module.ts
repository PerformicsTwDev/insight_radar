import { Module } from '@nestjs/common';
import { HealthModule } from './health';

/**
 * 應用根模組。
 *
 * M0 起逐步掛上功能模組（ConfigModule/CacheModule/PrismaModule…）。
 * 目前掛上 HealthModule（liveness placeholder，T0.1）。
 */
@Module({
  imports: [HealthModule],
})
export class AppModule {}
