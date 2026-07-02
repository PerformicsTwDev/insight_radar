"""TC-52 (NFR-11): reproducibility — fixed input vectors + random_state → identical
labels/probabilities across runs (within the same pinned environment)."""

from __future__ import annotations

from app.clustering import run_clustering
from app.schemas import ClusterRequest
from tests.conftest import make_blobs


def test_reproducible_labels_across_runs():
    vectors = make_blobs(seed=7)
    req = ClusterRequest(vectors=vectors)

    first = run_clustering(req)
    second = run_clustering(req)

    assert first.labels == second.labels
    assert first.probabilities == second.probabilities
    assert first.cluster_ids == second.cluster_ids
    assert first.exemplar_indices == second.exemplar_indices
    assert first.meta.n_clusters == second.meta.n_clusters


def test_reproducible_is_stable_and_finds_structure():
    vectors = make_blobs(seed=7)
    result = run_clustering(ClusterRequest(vectors=vectors))
    # 三個緊湊 blob → 應找到結構（≥1 群），非全 noise。
    assert result.meta.n_clusters >= 1
    assert any(label != -1 for label in result.labels)
