import { Global, Module } from '@nestjs/common';
import { JobMetricsContext } from './job-metrics.context';

/**
 * 可觀測性模組（T7.2，NFR-6）。`@Global` 提供單例 {@link JobMetricsContext}（AsyncLocalStorage 上下文），
 * 讓 processor 與各外部服務（google-ads / intent / cache）皆可注入、跨 async 邊界共享同一 job 的指標收集器。
 */
@Global()
@Module({
  providers: [JobMetricsContext],
  exports: [JobMetricsContext],
})
export class ObservabilityModule {}
