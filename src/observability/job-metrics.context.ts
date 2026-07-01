import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { JobMetrics } from './job-metrics';

/**
 * 每 job 可觀測指標的 **AsyncLocalStorage** 上下文（T7.2 slice B，NFR-6/TC-30）。processor 以 {@link run} 包住
 * `process()`；跨服務（AdsRateLimiter / AzureOpenAiService / cache mget）於同一 async 上下文內經 {@link current}
 * 取回**當前 job** 的 {@link JobMetrics} 並遞增計數——WORKER_CONCURRENCY>1 下亦正確歸屬到各自 job（不互相污染）。
 * 無上下文（非 job 呼叫路徑）時 {@link current} 回 `undefined`，呼叫端 no-op。
 */
@Injectable()
export class JobMetricsContext {
  private readonly als = new AsyncLocalStorage<JobMetrics>();

  /** 在此 metrics 上下文中執行 `fn`（其內的所有 await 皆可經 {@link current} 取回同一 metrics）。 */
  run<T>(metrics: JobMetrics, fn: () => Promise<T>): Promise<T> {
    return this.als.run(metrics, fn);
  }

  /** 取回當前 async 上下文的 metrics；不在任何 {@link run} 內 → `undefined`。 */
  current(): JobMetrics | undefined {
    return this.als.getStore();
  }
}
