import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** Liveness 模組（T0.1 placeholder）；T0.7 改用 `@nestjs/terminus` 健檢探針。 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
