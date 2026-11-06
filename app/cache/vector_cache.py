"""Image-id → detected-items semantic cache backed by ChromaDB.

Cut (b) uses string-id match only — true CLIP-embedding lookup is cut (c).
The `image_ref` string is the document id; the stored document is the
JSON-encoded list of `DetectedItem`s. A hit returns the cached list.

When ChromaDB is unavailable (not installed, persistent path unreadable)
the cache becomes a no-op so the route can degrade to live Gemini/HF.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from app.models.schemas import DetectedItem

log = logging.getLogger(__name__)

DEFAULT_PATH = "app/cache/chroma"
COLLECTION_NAME = "vision_detections"
USER_AGENT = "NutriVisionDemo/0.1 (hackathon demo)"


class VectorCache:
    """In-process ChromaDB cache for image → DetectedItem[] lookups."""

    def __init__(self, path: Path | str | None = None) -> None:
        raw = path or os.environ.get("CHROMA_CACHE_PATH") or DEFAULT_PATH
        self.path = Path(raw)
        self.path.mkdir(parents=True, exist_ok=True)
        self._collection = None
        self._available: bool | None = None

    def _ensure(self) -> Any | None:
        """Lazy-load ChromaDB. Returns the collection handle, or `None`
        when the package isn't installed (the cache is a no-op then)."""
        if self._available is False:
            return None
        if self._collection is not None:
            return self._collection
        try:
            import chromadb  # type: ignore[import-not-found]
            from chromadb.config import Settings
        except ImportError:
            self._available = False
            log.warning(
                "chromadb not installed — VectorCache disabled. "
                "`pip install -r requirements.txt` to enable."
            )
            return None
        try:
            client = chromadb.PersistentClient(
                path=str(self.path),
                settings=Settings(anonymized_telemetry=False),
            )
            self._collection = client.get_or_create_collection(
                name=COLLECTION_NAME,
                metadata={"hnsw:space": "cosine"},
            )
            self._available = True
        except Exception as exc:  # noqa: BLE001 — chromadb throws broadly
            self._available = False
            log.warning("ChromaDB init failed: %s — cache disabled", exc)
            return None
        return self._collection

    def has(self, image_ref: str) -> bool:
        col = self._ensure()
        if col is None:
            return False
        try:
            result = col.get(ids=[image_ref])
        except Exception as exc:  # noqa: BLE001
            log.warning("VectorCache.has failed: %s", exc)
            return False
        return bool(result.get("ids"))

    def get(self, image_ref: str) -> list[DetectedItem] | None:
        col = self._ensure()
        if col is None:
            return None
        try:
            result = col.get(ids=[image_ref])
        except Exception as exc:  # noqa: BLE001
            log.warning("VectorCache.get failed: %s", exc)
            return None
        docs = result.get("documents") or []
        if not docs:
            return None
        try:
            raw = json.loads(docs[0])
        except json.JSONDecodeError:
            return None
        return [DetectedItem.model_validate(item) for item in raw]

    def put(self, image_ref: str, detected: list[DetectedItem]) -> None:
        col = self._ensure()
        if col is None:
            return
        try:
            col.upsert(
                ids=[image_ref],
                documents=[json.dumps([d.model_dump() for d in detected])],
                metadatas=[{"count": len(detected)}],
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("VectorCache.put failed: %s", exc)
