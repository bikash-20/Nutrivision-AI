"""RAG (Retrieval-Augmented Nutrition) Router.

Exposes `/api/rag/query` for semantic retrieval against domain ChromaDB collections:
  - `bd_recipes_and_hidden_ingredients`
  - `clinical_nutrition_guidelines`
  - `bd_market_and_seasonal_produce`
  - `packaged_food_facts_bd`
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.services.rag_service import (
    RAGQueryRequest,
    RAGQueryResponse,
    RAGServiceUnavailable,
    get_rag_service,
)

router = APIRouter(prefix="/api/rag", tags=["rag"])


@router.post("/query", response_model=RAGQueryResponse)
def query_rag(request: RAGQueryRequest) -> RAGQueryResponse:
    """Execute a vector query against one curated knowledge collection."""
    service = get_rag_service()
    try:
        chunks = service.query(
            collection_name=request.collection_name,
            query_text=request.query,
            filters=request.filters,
            top_k=request.top_k,
        )
    except RAGServiceUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RAG knowledge base is temporarily unavailable.",
        ) from exc
    return RAGQueryResponse(
        query=request.query,
        collection=request.collection_name,
        results=chunks,
    )


@router.get("/health")
def rag_health() -> dict[str, object]:
    """Report readiness and indexed seed-document counts for curated collections."""
    try:
        counts = get_rag_service().health()
    except RAGServiceUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RAG knowledge base is temporarily unavailable.",
        ) from exc
    return {"status": "ok", "collections": counts}
