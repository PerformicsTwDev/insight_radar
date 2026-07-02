"""Shared pytest fixtures + deterministic synthetic-vector helpers."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def make_blobs(n_per: int = 20, centers: tuple[float, ...] = (0.0, 5.0, 10.0), dim: int = 50, seed: int = 0) -> list[list[float]]:
    """Tight, well-separated Gaussian blobs (deterministic via seed) → clean clusters."""
    rng = np.random.default_rng(seed)
    blobs = [rng.normal(center, 0.05, size=(n_per, dim)) for center in centers]
    return np.vstack(blobs).astype("float32").tolist()
