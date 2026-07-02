/**
 * 分群服務中立型別（T8.5，Design §16.2）。**snake_case 對齊 cluster-service `/cluster` wire 契約**
 * （Python FastAPI Pydantic 模型欄位名；不轉 camel 以免 client 端形狀漂移）。上層（T8.6/T8.9）依這些型別，
 * 不綁 HTTP 細節；`ClusterClient` 為唯一 adapter。
 */

/** UMAP 降維參數（服務端有預設；random_state 固定 + n_jobs=1 → 可重現，NFR-11）。 */
export interface UmapParams {
  n_neighbors: number;
  n_components: number;
  min_dist: number;
  metric: string;
  random_state: number;
}

/** HDBSCAN 參數（跑於 UMAP 降維後的 euclidean 空間）。 */
export interface HdbscanParams {
  min_cluster_size: number;
  min_samples: number | null;
  metric: string;
  cluster_selection_method: string;
}

/** `cluster()` 可選調參：未帶的欄位由 cluster-service 套預設（契約 §16.2）。 */
export interface ClusterParams {
  umap?: Partial<UmapParams>;
  hdbscan?: Partial<HdbscanParams>;
  top_k?: number;
}

/** POST /cluster 請求體（wire 契約 = vectors + 可選調參）。 */
export interface ClusterRequestBody extends ClusterParams {
  vectors: number[][];
}

/** 分群結果 meta（群數/noise 數/降維維度/seed/lib 版本指紋）。 */
export interface ClusterMeta {
  n_clusters: number;
  n_noise: number;
  reduced_dim: number;
  seed: number;
  lib_versions: Record<string, string>;
}

/**
 * /cluster 回應（wire 契約 §16.2）。`labels`/`probabilities` 長度 = 向量數；`noise = -1`（prob 0，合法值）；
 * `exemplar_indices` per-cluster、對齊 `cluster_ids`。
 */
export interface ClusterResult {
  labels: number[];
  probabilities: number[];
  cluster_ids: number[];
  exemplar_indices: number[][];
  meta: ClusterMeta;
}
