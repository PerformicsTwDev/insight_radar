"""FastAPI cluster-service (T8.4, FR-17/NFR-11/NFR-12).

- POST /cluster — UMAP → HDBSCAN; sync ``def`` so FastAPI runs it in the threadpool
  (CPU-bound; uvicorn workers ≈ cores).
- GET /healthz — pure 200 liveness.
- GET /readyz — confirm umap/hdbscan import + return the pinned lib-version fingerprint.
"""

from __future__ import annotations

from fastapi import FastAPI

from .clustering import lib_versions, run_clustering
from .schemas import ClusterRequest, ClusterResponse

app = FastAPI(title="cluster-service", version="0.1.0")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readyz")
def readyz() -> dict[str, object]:
    # import 成功即代表 umap/hdbscan 可用（模組載入時已 import）；回版本指紋供 provenance。
    return {"status": "ready", "lib_versions": lib_versions()}


@app.post("/cluster", response_model=ClusterResponse)
def cluster(req: ClusterRequest) -> ClusterResponse:
    return run_clustering(req)
