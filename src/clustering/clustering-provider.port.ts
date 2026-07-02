import type { ClusterParams, ClusterResult } from './clustering.types';

/**
 * 分群的 Port（T8.5，FR-15，NFR-3 可測 / DI 可替換）。上層依賴此介面，不綁 `@nestjs/axios` 或 HTTP 細節。
 * 本期 adapter = {@link ClusterClient}（HTTP → Python cluster-service）。
 */
export const CLUSTERING_PROVIDER = Symbol('CLUSTERING_PROVIDER');

export interface ClusteringProvider {
  /**
   * 對一批向量分群（UMAP → HDBSCAN，跑於獨立 Python 服務）。
   * @param vectors 每列一個關鍵字的 embedding（原生 3072 已 normalize）。
   * @param params 可選 UMAP/HDBSCAN 調參（未帶則服務端套預設）。
   * @returns 對齊輸入的 labels/probabilities（noise=-1）+ 每群代表索引 + meta。
   * @throws ClusteringUnavailableError 服務不可用（timeout / 傳輸層 / 5xx 達重試上限）——降級訊號。
   * @throws ClusteringContractError 回應違反契約（形狀漂移）。
   */
  cluster(vectors: number[][], params?: ClusterParams): Promise<ClusterResult>;
}
