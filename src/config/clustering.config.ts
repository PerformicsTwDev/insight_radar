import { registerAs } from '@nestjs/config';

/** 分群（cluster-service HTTP client）設定（值已由 env.validation Joi schema 驗證/補預設；M8，Design §16）。 */
export interface ClusteringConfig {
  /** Python cluster-service base URL（`POST {serviceUrl}/cluster`）。 */
  serviceUrl: string;
  /** 單次請求逾時（ms，預設 90000；CPU-bound UMAP+HDBSCAN 需長 timeout）。 */
  timeoutMs: number;
  /** 逾時/5xx/傳輸層暫時錯的退避重試上限（達上限 → 降級 partial）。 */
  retries: number;
  /** 退避起始延遲（ms，指數 `2^(n-1)*base`）。 */
  backoffBaseMs: number;
}

export const clusteringConfig = registerAs('clustering', (): ClusteringConfig => ({
  serviceUrl: process.env.CLUSTER_SERVICE_URL ?? '',
  timeoutMs: Number(process.env.CLUSTER_SERVICE_TIMEOUT_MS),
  retries: Number(process.env.CLUSTER_SERVICE_RETRIES),
  backoffBaseMs: Number(process.env.CLUSTER_SERVICE_BACKOFF_BASE_MS),
}));
