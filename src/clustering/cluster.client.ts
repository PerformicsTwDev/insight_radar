import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { defer, firstValueFrom, map, retry, throwError, timeout, TimeoutError, timer } from 'rxjs';
import { clusteringConfig } from '../config/clustering.config';
import { scrubSecrets } from '../logger/redaction';
import type { ClusteringProvider } from './clustering-provider.port';
import { ClusteringContractError, ClusteringUnavailableError } from './clustering.errors';
import type { ClusterParams, ClusterRequestBody, ClusterResult } from './clustering.types';

/** 傳輸層暫時性錯誤碼（同 SERP/embeddings；長跑 HTTP 常見的暫時失敗）。 */
const TRANSIENT_TRANSPORT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/**
 * 可重試：rxjs 逾時、數值 429/5xx、或傳輸層暫時錯（node 系統碼）。
 * **明確 4xx（非 429）→ 不重試**（請求本身有問題，重試無益）。
 */
function isRetryableClusterError(err: unknown): boolean {
  if (err instanceof TimeoutError) {
    return true;
  }
  const e = err as { response?: { status?: unknown }; status?: unknown; code?: unknown } | null;
  const rawStatus = e?.response?.status ?? e?.status;
  const status = typeof rawStatus === 'number' ? rawStatus : undefined;
  if (status === 429 || (status !== undefined && status >= 500 && status < 600)) {
    return true;
  }
  if (status !== undefined) {
    return false; // 明確 4xx（非 429）
  }
  const code = e?.code;
  return typeof code === 'string' && TRANSIENT_TRANSPORT_CODES.has(code);
}

/**
 * 分群 adapter（T8.5，Design §16.1/§16.2）：實作 {@link ClusteringProvider}，經 `@nestjs/axios` HTTP
 * `POST {CLUSTER_SERVICE_URL}/cluster` 呼叫獨立 Python cluster-service。
 *
 * - **每次嘗試獨立 `timeout`**（CPU-bound UMAP+HDBSCAN 需長 timeout）+ **指數退避 `retry`**（逾時/5xx/傳輸層）。
 * - `defer` 保證重試 resubscribe 會**重打** HTTP（不重用 stale observable）。
 * - 達重試上限 / 逾時 → 拋 {@link ClusteringUnavailableError}（降級訊號 → T8.9 標 partial，NFR-12）。
 * - **回應形狀驗證**（labels/probabilities 長度 = 向量數、exemplar_indices 對齊 cluster_ids）→ 不符拋
 *   {@link ClusteringContractError}（契約漂移，非降級）。
 */
@Injectable()
export class ClusterClient implements ClusteringProvider {
  private readonly logger = new Logger(ClusterClient.name);

  constructor(
    private readonly http: HttpService,
    @Inject(clusteringConfig.KEY) private readonly config: ConfigType<typeof clusteringConfig>,
  ) {}

  async cluster(vectors: number[][], params?: ClusterParams): Promise<ClusterResult> {
    const url = `${this.config.serviceUrl}/cluster`;
    const body: ClusterRequestBody = { vectors, ...(params ?? {}) };

    let result: ClusterResult;
    try {
      result = await firstValueFrom(
        // defer：每次（含重試）resubscribe 都重打一次 HTTP（不重用 stale observable）。
        defer(() => this.http.post<ClusterResult>(url, body)).pipe(
          timeout({ each: this.config.timeoutMs }),
          retry({
            count: this.config.retries,
            delay: (error: unknown, retryCount: number) => {
              if (!isRetryableClusterError(error)) {
                return throwError(() => error); // 非暫時性 → 立即停、不重試
              }
              const delayMs = this.config.backoffBaseMs * 2 ** (retryCount - 1);
              this.logger.warn(
                `cluster retry ${retryCount}/${this.config.retries} after ${delayMs}ms: ${scrubSecrets(String(error))}`,
              );
              return timer(delayMs);
            },
          }),
          map((response) => response.data),
        ),
      );
    } catch (error) {
      // 逾時 / 5xx / 傳輸層 達重試上限（或非暫時性失敗）→ 降級訊號（T8.9 據此標 partial，NFR-12）。
      throw new ClusteringUnavailableError(
        `cluster-service unavailable: ${scrubSecrets(String(error))}`,
        error,
      );
    }

    this.assertContract(result, vectors.length);
    return result;
  }

  /**
   * 契約形狀驗證（Design §16.2）：labels/probabilities 長度 = 向量數；cluster_ids/exemplar_indices 為陣列且
   * per-cluster 對齊。`labels` 內含 `-1`（noise）為合法值、不視為錯。
   */
  private assertContract(result: ClusterResult, expected: number): void {
    const ok =
      Array.isArray(result.labels) &&
      result.labels.length === expected &&
      Array.isArray(result.probabilities) &&
      result.probabilities.length === expected &&
      Array.isArray(result.cluster_ids) &&
      Array.isArray(result.exemplar_indices) &&
      result.exemplar_indices.length === result.cluster_ids.length &&
      typeof result.meta === 'object' &&
      result.meta !== null;
    if (!ok) {
      throw new ClusteringContractError(
        `cluster-service response violates contract (expected labels/probabilities length ${expected})`,
      );
    }
  }
}
