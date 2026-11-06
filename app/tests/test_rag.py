"""Tests for Phase 2: ChromaDB Multi-Collection RAG System."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.rag_service import RAGService


@pytest.fixture
def rag_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("RAG_CHROMA_PATH", str(tmp_path / "test_rag_chroma"))
    # Reset singleton
    import app.services.rag_service as rag_mod
    rag_mod._rag_service = RAGService(path=tmp_path / "test_rag_chroma")
    with TestClient(app) as c:
        yield c


def test_rag_query_clinical_guidelines_returns_birdem_citation(rag_client: TestClient):
    resp = rag_client.post(
        "/api/rag/query",
        json={
            "query": "What is the recommended rice portion for a diabetic patient?",
            "collection_name": "clinical_nutrition_guidelines",
            "top_k": 2,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["collection"] == "clinical_nutrition_guidelines"
    assert len(data["results"]) > 0
    # First result should discuss rice portion and cite BIRDEM
    first = data["results"][0]
    assert "BIRDEM" in first["citation"] or "BIRDEM" in first["document"]


def test_rag_query_recipes_returns_authentic_shorshe_ilish(rag_client: TestClient):
    resp = rag_client.post(
        "/api/rag/query",
        json={
            "query": "Hilsa fish cooked with mustard oil and green chilies",
            "collection_name": "bd_recipes_and_hidden_ingredients",
            "top_k": 2,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["results"]) > 0
    match = any("Ilish" in r["document"] or "সর্ষে ইলিশ" in r["document"] for r in data["results"])
    assert match is True
    assert "INFS" in data["results"][0]["citation"] or "Bangladesh" in data["results"][0]["citation"]


def test_rag_query_seasonal_produce_returns_winter_market_prices(rag_client: TestClient):
    resp = rag_client.post(
        "/api/rag/query",
        json={
            "query": "Winter seasonal vegetables like cauliflower and spinach prices",
            "collection_name": "bd_market_and_seasonal_produce",
            "top_k": 2,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["results"]) > 0
    assert any("cauliflower" in r["document"].lower() or "phulkopi" in r["document"].lower() for r in data["results"])


def test_rag_rejects_non_curated_collection(rag_client: TestClient) -> None:
    response = rag_client.post(
        "/api/rag/query",
        json={"query": "list cached photos", "collection_name": "vision_detections"},
    )

    assert response.status_code == 422


def test_rag_rejects_blank_and_oversized_queries() -> None:
    from app.services.rag_service import RAGQueryRequest

    with pytest.raises(ValueError):
        RAGQueryRequest(query="  ", collection_name="clinical_nutrition_guidelines")
    with pytest.raises(ValueError):
        RAGQueryRequest(query="x" * 1001, collection_name="clinical_nutrition_guidelines")


def test_rag_storage_is_separate_from_vision_cache(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHROMA_CACHE_PATH", str(tmp_path / "vision-cache"))
    monkeypatch.setenv("RAG_CHROMA_PATH", str(tmp_path / "rag-store"))

    service = RAGService()

    assert service.path == tmp_path / "rag-store"
    assert service.path != tmp_path / "vision-cache"


def test_rag_service_seeds_all_collections_and_returns_seed_citation(tmp_path: Path) -> None:
    from app.services.rag_service import COLLECTION_SEEDS

    class _Collection:
        def __init__(self) -> None:
            self.records: dict[str, tuple[str, dict[str, object]]] = {}

        def upsert(self, *, ids, documents, metadatas) -> None:
            self.records.update({
                doc_id: (document, metadata)
                for doc_id, document, metadata in zip(ids, documents, metadatas, strict=True)
            })

        def count(self) -> int:
            return len(self.records)

        def query(self, **_kwargs):
            doc_id, (document, metadata) = next(iter(self.records.items()))
            return {
                "ids": [[doc_id]],
                "documents": [[document]],
                "metadatas": [[metadata]],
                "distances": [[0.1]],
            }

    class _Client:
        def __init__(self) -> None:
            self.collections: dict[str, _Collection] = {}

        def get_or_create_collection(self, *, name, **_kwargs):
            return self.collections.setdefault(name, _Collection())

    service = RAGService(path=tmp_path / "rag-store")
    service._client = _Client()

    counts = service.health()
    chunks = service.query("clinical_nutrition_guidelines", "rice portion")

    assert counts == {name: len(docs) for name, docs in COLLECTION_SEEDS.items()}
    assert chunks[0].citation == "ADA Guidelines"


def test_rag_health_reports_curated_collection_counts(
    rag_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api import rag as rag_api

    class _ReadyRAG:
        def health(self):
            return {
                "bd_recipes_and_hidden_ingredients": 8,
                "clinical_nutrition_guidelines": 6,
                "bd_market_and_seasonal_produce": 3,
                "packaged_food_facts_bd": 3,
            }

    monkeypatch.setattr(rag_api, "get_rag_service", lambda: _ReadyRAG())
    response = rag_client.get("/api/rag/health")

    assert response.status_code == 200
    health = response.json()
    assert health["status"] == "ok"
    assert set(health["collections"]) == {
        "bd_recipes_and_hidden_ingredients",
        "clinical_nutrition_guidelines",
        "bd_market_and_seasonal_produce",
        "packaged_food_facts_bd",
    }


def test_bengali_clinical_query_returns_cited_evidence(rag_client: TestClient) -> None:
    response = rag_client.post(
        "/api/rag/query",
        json={
            "query": "ডায়াবেটিস রোগীর ভাতের পরিমাণ কত হওয়া উচিত?",
            "collection_name": "clinical_nutrition_guidelines",
            "top_k": 3,
        },
    )

    assert response.status_code == 200
    results = response.json()["results"]
    assert results
    assert any("BIRDEM" in result["citation"] for result in results)


def test_rag_unavailable_is_reported_as_503(rag_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api import rag as rag_api
    from app.services.rag_service import RAGServiceUnavailable

    class _Unavailable:
        def query(self, **_kwargs):
            raise RAGServiceUnavailable("internal store error")

    monkeypatch.setattr(rag_api, "get_rag_service", lambda: _Unavailable())
    response = rag_client.post(
        "/api/rag/query",
        json={
            "query": "rice portion",
            "collection_name": "clinical_nutrition_guidelines",
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "RAG knowledge base is temporarily unavailable."


def test_rag_health_unavailable_is_reported_as_503(
    rag_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api import rag as rag_api
    from app.services.rag_service import RAGServiceUnavailable

    class _Unavailable:
        def health(self):
            raise RAGServiceUnavailable("internal store error")

    monkeypatch.setattr(rag_api, "get_rag_service", lambda: _Unavailable())
    response = rag_client.get("/api/rag/health")

    assert response.status_code == 503
    assert response.json()["detail"] == "RAG knowledge base is temporarily unavailable."
