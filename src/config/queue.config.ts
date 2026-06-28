import { registerAs } from '@nestjs/config';

export interface QueueConfig {
  /** BullMQ worker 同時處理的 job 數（已 Joi 驗證 min1，預設 5；NFR-8 WORKER_CONCURRENCY）。 */
  workerConcurrency: number;
  /** job 失敗重試次數（已 Joi 驗證 min1，預設 5；Design §14 JOB_ATTEMPTS）。 */
  jobAttempts: number;
  /** 重試指數退避起始延遲（毫秒，已 Joi 驗證 min0，預設 3000；`2^(n-1)*delay`）。 */
  jobBackoffMs: number;
  /** idempotency 快取 TTL（毫秒，已 Joi 驗證 min0，預設 1 天；Design §5.3 idemp:{hash}）。 */
  idempTtlMs: number;
  /** `job:{analysisId}` 狀態摘要快取 TTL（毫秒，已 Joi 驗證 min0，預設 3 天）。 */
  jobTtlMs: number;
}

/** Queue / job 運維設定（值已由 env.validation Joi schema 驗證/補預設）。 */
export const queueConfig = registerAs('queue', (): QueueConfig => ({
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY),
  jobAttempts: Number(process.env.JOB_ATTEMPTS),
  jobBackoffMs: Number(process.env.JOB_BACKOFF_MS),
  idempTtlMs: Number(process.env.IDEMP_TTL_MS),
  jobTtlMs: Number(process.env.JOB_TTL_MS),
}));
