# cluster-service (T8.4) — 無狀態 UMAP + HDBSCAN 分群微服務。
# Python 3.11（umap-learn/hdbscan/numba 相容）；lib 版本由 requirements.txt 釘死（可重現，NFR-11）。
FROM python:3.11-slim

# 可重現性：單執行緒 BLAS/OMP + 固定 hash seed（配合固定 random_state + UMAP n_jobs=1）。
ENV OMP_NUM_THREADS=1 \
    PYTHONHASHSEED=0 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000
# CPU-bound：uvicorn workers ≈ 核心數（由部署環境以 --workers 設定）。
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
