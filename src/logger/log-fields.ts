/**
 * 結構化 log 欄位名（NFR-6 可觀測）。集中管理、避免散落字串；供後續觀測任務（TC-30：
 * 各階段計時、cache hit-rate、外部 API 呼叫/retry 數）複用。
 */
export const LogField = {
  PHASE: 'phase',
  ANALYSIS_ID: 'analysisId',
  TOPIC_JOB_ID: 'topicJobId',
  DURATION_MS: 'durationMs',
  CACHE_HIT_RATE: 'cacheHitRate',
  EXTERNAL_CALLS: 'externalCalls',
  RETRIES: 'retries',
  REQUEST_ID: 'requestId',
} as const;

export type LogField = (typeof LogField)[keyof typeof LogField];

/** pipeline 階段名（與 Design §3 / TC-30 對齊）。 */
export const LogPhase = {
  EXPAND: 'expand',
  METRICS: 'metrics',
  INTENT: 'intent',
  PERSIST: 'persist',
} as const;

export type LogPhase = (typeof LogPhase)[keyof typeof LogPhase];
