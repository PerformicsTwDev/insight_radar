# cluster-service (T8.4)

Stateless Python microservice for topic clustering (FR-17 / NFR-11 / NFR-12). Called by the NestJS
backend's `ClusteringProvider` (T8.5) over HTTP. **Not** part of the NestJS/jest build — its own
Python stack + pytest.

## Endpoints

- `POST /cluster` — UMAP (→ ~10-dim) then scikit-learn-contrib **HDBSCAN** (euclidean). Returns
  `labels` (noise `-1`), `probabilities` (soft; noise `0`), `cluster_ids`, `exemplar_indices`
  (per-cluster, aligned to `cluster_ids`), and `meta` (`n_clusters`, `n_noise`, `reduced_dim`,
  `seed`, `lib_versions`). Sync `def` → FastAPI threadpool (CPU-bound).
- `GET /healthz` — pure 200 liveness.
- `GET /readyz` — confirms `umap`/`hdbscan` import + returns the pinned lib-version fingerprint.

## Reproducibility (NFR-11)

Fixed `random_state=42` + UMAP `n_jobs=1` + Docker `OMP_NUM_THREADS=1` / `PYTHONHASHSEED=0` +
pinned lib versions (`requirements.txt`). Deterministic **within** a pinned environment; cross-env
bit-level identity is not guaranteed (upstream UMAP/HDBSCAN note).

## Dev

```bash
python3.11 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
OMP_NUM_THREADS=1 PYTHONHASHSEED=0 .venv/bin/python -m pytest -q
```

## Docker

```bash
docker build -t cluster-service .
docker run -p 8000:8000 cluster-service
```

CI: the main backend CI mocks the `/cluster` contract (T8.5). This service is exercised by its own
pytest (path-filtered `cluster-service.yml` + a weekly smoke), not the per-PR jest gate.
