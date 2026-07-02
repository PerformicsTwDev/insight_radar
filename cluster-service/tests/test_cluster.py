"""TC-42 (FR-17): POST /cluster contract + /healthz + /readyz."""

from __future__ import annotations

from tests.conftest import make_blobs


def test_healthz_is_pure_liveness(client):
    res = client.get("/healthz")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_readyz_reports_lib_version_fingerprint(client):
    res = client.get("/readyz")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ready"
    assert "umap-learn" in body["lib_versions"]
    assert "hdbscan" in body["lib_versions"]


def test_cluster_contract_shapes(client):
    vectors = make_blobs()
    res = client.post("/cluster", json={"vectors": vectors})
    assert res.status_code == 200
    body = res.json()

    n = len(vectors)
    # labels/probabilities 長度 = 向量數
    assert len(body["labels"]) == n
    assert len(body["probabilities"]) == n
    # 至少找到一個群
    assert len(body["cluster_ids"]) >= 1
    assert body["meta"]["n_clusters"] == len(body["cluster_ids"])
    # exemplar_indices per-cluster、對齊 cluster_ids、索引在範圍內
    assert len(body["exemplar_indices"]) == len(body["cluster_ids"])
    for idxs in body["exemplar_indices"]:
        assert len(idxs) >= 1
        assert all(0 <= i < n for i in idxs)
    # meta
    assert body["meta"]["reduced_dim"] >= 2
    assert body["meta"]["seed"] == 42


def test_noise_points_have_probability_zero(client):
    # 3 blobs + 遠離的離群點 → 造出 noise（label -1）。
    vectors = make_blobs()
    outliers = [[100.0 + i] * 50 for i in range(3)]
    vectors = vectors + outliers
    res = client.post("/cluster", json={"vectors": vectors})
    body = res.json()

    noise_probs = [body["probabilities"][i] for i, label in enumerate(body["labels"]) if label == -1]
    assert all(p == 0.0 for p in noise_probs)
    assert body["meta"]["n_noise"] == body["labels"].count(-1)


def test_determinism_same_input_same_labels(client):
    vectors = make_blobs()
    a = client.post("/cluster", json={"vectors": vectors}).json()
    b = client.post("/cluster", json={"vectors": vectors}).json()
    assert a["labels"] == b["labels"]
    assert a["cluster_ids"] == b["cluster_ids"]


def test_rejects_empty_vectors(client):
    res = client.post("/cluster", json={"vectors": []})
    assert res.status_code == 422  # min_length=1
