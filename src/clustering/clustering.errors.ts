/**
 * 分群服務不可用：timeout / 傳輸層暫時錯 / 5xx 達重試上限（或非暫時性傳輸失敗）。
 *
 * 這是 **可辨識的降級訊號**：上層 `TopicClusterProcessor`（T8.9）據此把 job 標 `partial`、保留已完成階段
 * （NFR-12「任一外部階段失敗達重試上限 → job 標 partial」）。訊息已 `scrubSecrets`（NFR-5）。
 */
export class ClusteringUnavailableError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ClusteringUnavailableError';
  }
}

/**
 * 分群服務回應違反契約（形狀漂移：labels/probabilities 長度 ≠ 向量數、exemplar_indices 未對齊 cluster_ids…）。
 *
 * **非降級、是 bug**（重試無益）：指向 cluster-service 或 client 契約不同步，需修正而非標 partial。與
 * {@link ClusteringUnavailableError} 分型，讓 T8.9 得以區別處置。
 */
export class ClusteringContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClusteringContractError';
  }
}
