"""Tests for Price Scraper and `/api/market/price` endpoint."""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services.price_scraper import PriceScraper


@pytest.fixture
def client() -> TestClient:
    app = create_app()
    return TestClient(app)


def test_scraper_fallback_to_local_json() -> None:
    scraper = PriceScraper()
    res = scraper.get_fallback_price("Brown rice (Lal chal)", "লাল চাল")
    assert res.price_bdt > 0
    assert "লাল চাল" in (res.item_name_bn or "")
    assert res.is_live_price is False
    assert "TCB/DAM" in res.source


def test_scraper_strict_timeout_and_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    scraper = PriceScraper()
    # Point search URL to an invalid / unreachable endpoint to test fallback
    monkeypatch.setattr("app.services.price_scraper.CHALDAL_SEARCH_URL", "http://127.0.0.1:59999/search")
    start = time.time()
    res = scraper.fetch_live_price("White rice (Miniket)")
    duration = time.time() - start
    # Must complete fast and fallback cleanly
    assert duration < 3.5
    assert res.price_bdt > 0
    assert res.is_live_price is False
    assert "TCB/DAM" in res.source


def test_scraper_demo_live_mode() -> None:
    scraper = PriceScraper()
    res = scraper.fetch_live_price("Palong shak (Spinach)", "পালং শাক", force_mock_live=True)
    assert res.is_live_price is True
    assert res.price_bdt > 0
    assert "Chaldal Live" in res.source


def test_api_market_price_endpoint(client: TestClient) -> None:
    res = client.get("/api/market/price?q=Rice")
    assert res.status_code == 200
    data = res.json()
    assert "price_bdt" in data
    assert "unit" in data
    assert "is_live_price" in data
    assert data["price_bdt"] > 0


def test_scraper_live_chaldal_cucumber() -> None:
    scraper = PriceScraper()
    res = scraper.fetch_live_price("Cucumber")
    assert res.price_bdt == 39.0
    assert res.is_live_price is True
    assert "Chaldal" in res.source


def test_scraper_live_chaldal_produce_basket() -> None:
    scraper = PriceScraper()
    for item in ["Potato", "Onion", "Green Chilli"]:
        res = scraper.fetch_live_price(item)
        assert res.price_bdt > 0
        assert res.is_live_price is True
        assert "Chaldal" in res.source


def test_scraper_live_bengali_query() -> None:
    scraper = PriceScraper()
    res = scraper.fetch_live_price("শসা")
    assert res.price_bdt in (35.0, 39.0)
    assert res.is_live_price is True
    assert "Chaldal" in res.source


def test_scraper_live_tomato_and_bengali() -> None:
    scraper = PriceScraper()
    for query in ["Tomato", "Tomatoes", "Tomato (টমেটো)", "টমেটো"]:
        res = scraper.fetch_live_price(query)
        assert res.price_bdt == 99.0
        assert res.is_live_price is True
        assert "Chaldal" in res.source



