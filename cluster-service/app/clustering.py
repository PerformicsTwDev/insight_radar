"""UMAP → HDBSCAN clustering (FR-17, NFR-11). Deterministic within an environment:
fixed random_state + UMAP n_jobs=1 + (Dockerfile) OMP_NUM_THREADS=1 / PYTHONHASHSEED=0.
Uses scikit-learn-contrib ``hdbscan`` (NOT sklearn.cluster.HDBSCAN) for soft
``probabilities_`` + ``exemplars_``.
"""

from __future__ import annotations

import warnings
from importlib.metadata import PackageNotFoundError, version

import hdbscan
import numpy as np
import umap

from .schemas import ClusterMeta, ClusterRequest, ClusterResponse

_LIB_NAMES = ["umap-learn", "hdbscan", "numpy", "scikit-learn", "numba"]


def lib_versions() -> dict[str, str]:
    """Pinned lib version fingerprint (reproducibility provenance, /readyz + meta)."""
    out: dict[str, str] = {}
    for name in _LIB_NAMES:
        try:
            out[name] = version(name)
        except PackageNotFoundError:
            out[name] = "unknown"
    return out


def _exemplar_indices(
    clusterer: hdbscan.HDBSCAN,
    reduced: np.ndarray,
    labels: list[int],
    probabilities: list[float],
    cluster_ids: list[int],
    top_k: int,
) -> list[list[int]]:
    """Per-cluster representative indices, aligned to ``cluster_ids``. Prefer contrib
    ``exemplars_`` (points → row indices in ``reduced``); fall back to top-by-probability."""
    exemplars = getattr(clusterer, "exemplars_", None)
    result: list[list[int]] = []
    for cluster_id in cluster_ids:
        idxs: list[int] = []
        if exemplars is not None and cluster_id < len(exemplars):
            for point in np.asarray(exemplars[cluster_id]):
                matches = np.where((reduced == point).all(axis=1))[0]
                if len(matches):
                    idxs.append(int(matches[0]))
        if idxs:
            result.append(sorted(set(idxs))[:top_k])
            continue
        # fallback: highest-membership members of the cluster
        members = [i for i, label in enumerate(labels) if label == cluster_id]
        members.sort(key=lambda i: probabilities[i], reverse=True)
        result.append(members[:top_k])
    return result


def run_clustering(req: ClusterRequest) -> ClusterResponse:
    matrix = np.asarray(req.vectors, dtype=np.float32)
    n_samples = matrix.shape[0]

    # UMAP requires n_neighbors < n_samples and n_components < n_samples — clamp for small inputs.
    n_neighbors = max(2, min(req.umap.n_neighbors, n_samples - 1))
    n_components = max(2, min(req.umap.n_components, n_samples - 2)) if n_samples > 3 else 2

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        reducer = umap.UMAP(
            n_neighbors=n_neighbors,
            n_components=n_components,
            min_dist=req.umap.min_dist,
            metric=req.umap.metric,
            random_state=req.umap.random_state,
            n_jobs=1,  # 強制單執行緒 → 可重現（NFR-11）
        )
        reduced = np.asarray(reducer.fit_transform(matrix), dtype=np.float32)

        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=req.hdbscan.min_cluster_size,
            min_samples=req.hdbscan.min_samples,
            metric=req.hdbscan.metric,
            cluster_selection_method=req.hdbscan.cluster_selection_method,
            prediction_data=True,  # 啟用 soft probabilities_ / exemplars_（contrib 版）
        ).fit(reduced)

    labels = [int(label) for label in clusterer.labels_]
    # noise (-1) 一律 prob 0（TC-42）；非 noise 用 soft membership。
    probabilities = [
        0.0 if labels[i] == -1 else float(clusterer.probabilities_[i]) for i in range(n_samples)
    ]
    cluster_ids = sorted({label for label in labels if label != -1})
    exemplar_indices = _exemplar_indices(
        clusterer, reduced, labels, probabilities, cluster_ids, req.top_k
    )

    return ClusterResponse(
        labels=labels,
        probabilities=probabilities,
        cluster_ids=cluster_ids,
        exemplar_indices=exemplar_indices,
        meta=ClusterMeta(
            n_clusters=len(cluster_ids),
            n_noise=sum(1 for label in labels if label == -1),
            reduced_dim=n_components,
            seed=req.umap.random_state,
            lib_versions=lib_versions(),
        ),
    )
