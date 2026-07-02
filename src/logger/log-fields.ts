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
  // 每 job 摘要欄位（T7.2）。
  STATUS: 'status',
  PHASES: 'phases',
  EXPANDED: 'expanded',
  LABELED: 'labeled',
  TOTAL: 'total',
  // 分群 job 摘要欄位（T8.12，NFR-11）。
  KEYWORD_COUNT: 'keywordCount',
  CLUSTER_COUNT: 'clusterCount',
  NOISE_COUNT: 'noiseCount',
  DEGRADED: 'degraded',
} as const;

export type LogField = (typeof LogField)[keyof typeof LogField];

/**
 * pipeline 階段名（與 Design §3 對齊）。⚠ **可分離計時 span 僅 `expand` + `persist`**（Design §12.2 / TC-30，
 * M7-R2）：expand 涵蓋 fetch+label 的 A/B 重疊段（NFR-1 邊拓展邊貼標，非可分離的獨立階段），metrics 隨 Ads
 * 回應夾帶（無獨立 I/O）→ processor 只對 `EXPAND`/`PERSIST` `startPhase`；`METRICS`/`INTENT` 保留作進度標記名
 * （`report()` 進度階段），**不**作為獨立計時 span emit。
 */
export const LogPhase = {
  EXPAND: 'expand',
  METRICS: 'metrics',
  INTENT: 'intent',
  PERSIST: 'persist',
} as const;

export type LogPhase = (typeof LogPhase)[keyof typeof LogPhase];
