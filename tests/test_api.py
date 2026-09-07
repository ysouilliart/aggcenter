"""API tests for the aggregation center."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.aggregator import seed_store
from app.main import app, store


@pytest.fixture(autouse=True)
def reset_store():
    """Reset to a known seeded state before each test."""
    store.clear()
    seed_store(store)
    yield
    store.clear()
    seed_store(store)


@pytest.fixture()
def client():
    return TestClient(app)


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert "version" in body


def test_dashboard_served(client):
    res = client.get("/")
    assert res.status_code == 200
    assert "aggcenter" in res.text


def test_list_seeded_sources(client):
    res = client.get("/api/sources")
    assert res.status_code == 200
    sources = res.json()
    assert len(sources) == 5
    assert {s["name"] for s in sources} >= {"web-analytics", "subscriptions"}


def test_aggregate_math(client):
    res = client.get("/api/aggregate")
    assert res.status_code == 200
    agg = res.json()
    assert agg["source_count"] == 5
    # 1280 + 845 + 5230.5 + 9120 + 12 = 16487.5
    assert agg["total_value"] == pytest.approx(16487.5)
    assert agg["average_value"] == pytest.approx(16487.5 / 5)

    categories = {c["category"]: c for c in agg["categories"]}
    assert categories["traffic"]["count"] == 2
    assert categories["traffic"]["total"] == pytest.approx(2125.0)
    assert categories["revenue"]["total"] == pytest.approx(14350.5)


def test_create_and_fetch_source(client):
    res = client.post(
        "/api/sources",
        json={"name": "payments-api", "category": "revenue", "value": 100.0},
    )
    assert res.status_code == 201
    created = res.json()
    assert created["id"] == 6
    assert created["name"] == "payments-api"

    res = client.get(f"/api/sources/{created['id']}")
    assert res.status_code == 200
    assert res.json()["name"] == "payments-api"

    agg = client.get("/api/aggregate").json()
    assert agg["source_count"] == 6
    assert agg["total_value"] == pytest.approx(16587.5)


def test_get_missing_source_returns_404(client):
    res = client.get("/api/sources/9999")
    assert res.status_code == 404


def test_create_source_validation_error(client):
    res = client.post("/api/sources", json={"name": "", "category": "x", "value": 1})
    assert res.status_code == 422
