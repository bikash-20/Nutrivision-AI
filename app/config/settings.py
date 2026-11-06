"""Typed settings for NutriVision AI backend.

Loads environment variables with fallback defaults. All configuration
constants live here rather than being scattered across modules.
"""

from __future__ import annotations

import os
from pathlib import Path

from pydantic import BaseModel, Field


class Settings(BaseModel):
    # Base paths
    app_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[1])
    data_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[1] / "data")

    # API Keys
    gemini_api_key: str = Field(default_factory=lambda: os.environ.get("GEMINI_API_KEY", ""))
    gemini_model: str = Field(default_factory=lambda: os.environ.get("GEMINI_MODEL", "gemini-2.0-flash"))
    groq_api_key: str = Field(default_factory=lambda: os.environ.get("GROQ_API_KEY", ""))
    groq_model: str = Field(default_factory=lambda: os.environ.get("GROQ_MODEL", "llama-3.2-11b-vision-preview"))
    hf_api_token: str = Field(default_factory=lambda: os.environ.get("HF_API_TOKEN", ""))
    usda_api_key: str = Field(default_factory=lambda: os.environ.get("USDA_API_KEY", "DEMO_KEY"))

    # Service URLs
    off_base_url: str = Field(default_factory=lambda: os.environ.get("OFF_BASE_URL", "https://world.openfoodfacts.org"))
    usda_base_url: str = Field(default_factory=lambda: os.environ.get("USDA_BASE_URL", "https://api.nal.usda.gov/fdc/v1"))
    fruityvice_base_url: str = Field(default_factory=lambda: os.environ.get("FRUITYVICE_BASE_URL", "https://www.fruityvice.com/api"))

    # Limits & Cache TTLs
    max_request_bytes: int = 8 * 1024 * 1024
    sqlite_cache_path: str = Field(default_factory=lambda: os.environ.get("SQLITE_CACHE_PATH", "app/cache/cache.db"))
    chroma_cache_path: str = Field(default_factory=lambda: os.environ.get("CHROMA_CACHE_PATH", "app/cache/chroma"))
    vision_cache_ttl_s: int = Field(default_factory=lambda: int(os.environ.get("VISION_CACHE_TTL", str(7 * 24 * 3600))))
    nutrition_cache_ttl_s: int = Field(default_factory=lambda: int(os.environ.get("NUTRITION_CACHE_TTL", str(24 * 3600))))

    # State file
    state_path: str = Field(default_factory=lambda: os.environ.get("STATE_PATH", "app/state.json"))


settings = Settings()

