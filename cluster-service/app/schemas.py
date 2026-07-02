"""Pydantic v2 request/response models for POST /cluster (Design §16.2)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class UmapParams(BaseModel):
    """UMAP 降維參數。random_state 固定 + n_jobs=1（服務端強制）→ 可重現（NFR-11）。"""

    n_neighbors: int = 15
    n_components: int = 10
    min_dist: float = 0.0
    metric: str = "cosine"
    random_state: int = 42


class HdbscanParams(BaseModel):
    """HDBSCAN 參數（跑於 UMAP 降維後的 euclidean 空間）。"""

    min_cluster_size: int = 8
    min_samples: int | None = None
    metric: str = "euclidean"
    cluster_selection_method: str = "eom"


class ClusterRequest(BaseModel):
    """/cluster 輸入：向量 + UMAP/HDBSCAN 參數 + 代表點上限。"""

    vectors: list[list[float]] = Field(..., min_length=1)
    umap: UmapParams = Field(default_factory=UmapParams)
    hdbscan: HdbscanParams = Field(default_factory=HdbscanParams)
    top_k: int = 20


class ClusterMeta(BaseModel):
    n_clusters: int
    n_noise: int
    reduced_dim: int
    seed: int
    lib_versions: dict[str, str]


class ClusterResponse(BaseModel):
    """/cluster 輸出：labels/probabilities 長度 = 向量數；noise=-1（prob 0）。"""

    labels: list[int]
    probabilities: list[float]
    cluster_ids: list[int]
    exemplar_indices: list[list[int]]
    meta: ClusterMeta
