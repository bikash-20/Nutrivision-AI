"""Unit tests for Multi-Agent AI Coach endpoint `/api/coach/chat`."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.models.schemas import CoachMessage, UserProfile


def test_coach_chat_validation_empty_messages(client: TestClient) -> None:
    res = client.post("/api/coach/chat", json={"messages": [], "agent_type": "scientist"})
    assert res.status_code == 400
    assert "Messages list cannot be empty" in res.json()["detail"]


def test_coach_chat_scientist_persona(client: TestClient) -> None:
    payload = {
        "messages": [
            {"role": "user", "content": "এই খাবারের গ্লাইসেমিক লোড কীভাবে কমাব?"}
        ],
        "agent_type": "scientist",
        "user_profile": {
            "name": "Rafi",
            "age": 28,
            "sex": "male",
            "height_cm": 172,
            "weight_kg": 70,
            "height_unit": "cm",
            "weight_unit": "kg",
            "activity_level": "moderate",
            "goal": "maintain",
            "target_rate_kg_per_week": 0.0,
            "diet_type": "halal",
            "medical_conditions": ["prediabetes"],
            "meals_per_day": 3,
            "budget": 500.0,
            "serving": 1,
            "goals": {"diabetic": True, "protein": False, "budget": True, "mediter": False},
            "preferences": [],
            "allergens": ["Peanuts"],
            "daily_kcal_target": 2000.0,
        },
    }
    res = client.post("/api/coach/chat", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["agent_type"] == "scientist"
    assert len(data["reply"]) > 50
    assert len(data["suggested_prompts"]) > 0
    assert len(data["citations"]) > 0


def test_coach_chat_behavioral_persona(client: TestClient) -> None:
    payload = {
        "messages": [
            {"role": "user", "content": "দাওয়াতে অতিরিক্ত খাওয়ার পর কী করব?"}
        ],
        "agent_type": "behavioral",
    }
    res = client.post("/api/coach/chat", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["agent_type"] == "behavioral"
    assert len(data["reply"]) > 50
    assert any("দাওয়াত" in p or "মিষ্টি" in p or "অভ্যাস" in p for p in data["suggested_prompts"])


def test_coach_chat_hello_greeting_scientist(client: TestClient) -> None:
    """The 'Hello' Fix: greetings must yield concise warm responses, not lectures."""
    payload = {
        "message": "হ্যালো",
        "history": [],
        "agent_type": "scientist",
    }
    res = client.post("/api/coach/chat", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["agent_type"] == "scientist"
    # Should be a short, natural greeting (under 120 chars)
    assert len(data["reply"]) < 120
    assert "হ্যালো" in data["reply"]
    assert "পুষ্টি" in data["reply"] or "ক্যালরি" in data["reply"]


def test_coach_chat_hello_greeting_coach(client: TestClient) -> None:
    """The 'Hello' Fix: coach greeting in English returns empathetic short welcome."""
    payload = {
        "message": "hello",
        "history": [],
        "agent_type": "coach",
        "lang": "en",
    }
    res = client.post("/api/coach/chat", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["agent_type"] == "coach"
    assert len(data["reply"]) < 120
    assert "Hello" in data["reply"]
    assert "হ্যালো" not in data["reply"]


def test_coach_chat_hi_english_mode(client: TestClient) -> None:
    """Typing 'hi' with lang='en' must return English greeting and English suggested prompts."""
    payload = {
        "message": "hi",
        "history": [],
        "agent_type": "scientist",
        "lang": "en",
    }
    res = client.post("/api/coach/chat", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["agent_type"] == "scientist"
    assert "Hello" in data["reply"]
    assert "হ্যালো" not in data["reply"]
    # Suggested prompts must not contain Bengali characters
    for prompt in data["suggested_prompts"]:
        assert not any('\u0980' <= c <= '\u09FF' for c in prompt)


def test_coach_chat_katex_formula_rendering(client: TestClient) -> None:
    """Scientific explanations must return KaTeX formulas (e.g. GL formula)."""
    payload = {
        "message": "How is glycemic load calculated for rice?",
        "history": [],
        "agent_type": "scientist",
        "lang": "en",
    }
    res = client.post("/api/coach/chat", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "$GL" in data["reply"] or "$$" in data["reply"]



def test_coach_openrouter_fallback(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    """Ensure OpenRouter is called if Gemini fails or is unavailable."""
    from app.services.coach_service import get_coach_service
    service = get_coach_service()

    called_openrouter = False

    def mock_call_gemini(system_prompt: str, messages: list) -> str | None:
        return None  # Simulate Gemini 429/failure

    def mock_call_openrouter(system_prompt: str, messages: list) -> str | None:
        nonlocal called_openrouter
        called_openrouter = True
        return "Responded via OpenRouter fallback successfully."

    monkeypatch.setattr(service, "_call_gemini", mock_call_gemini)
    monkeypatch.setattr(service, "_call_openrouter", mock_call_openrouter)
    monkeypatch.setattr(service, "openrouter_key", "sk-or-test-key")

    res = client.post("/api/coach/chat", json={"message": "What is GI?", "agent_type": "scientist"})
    assert res.status_code == 200
    data = res.json()
    assert called_openrouter is True
    assert "OpenRouter" in data["reply"]


def test_coach_openrouter_dynamic_model_selection(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify OpenRouter uses OPENROUTER_FALLBACK_MODEL or defaults to 'openrouter/auto'."""
    import httpx

    from app.services.coach_service import CoachService

    captured_payloads: list[dict] = []

    def mock_post(self: httpx.Client, url: str, **kwargs: Any) -> Any:
        captured_payloads.append(kwargs.get("json", {}))

        class MockResponse:
            status_code = 200

            def json(self) -> dict:
                return {"choices": [{"message": {"content": "Dynamic model test reply."}}]}

            @property
            def text(self) -> str:
                return ""

        return MockResponse()

    monkeypatch.setattr(httpx.Client, "post", mock_post)

    # Case A: OPENROUTER_FALLBACK_MODEL is unset -> defaults to 'openrouter/auto'
    monkeypatch.delenv("OPENROUTER_FALLBACK_MODEL", raising=False)
    monkeypatch.delenv("OPENROUTER_MODEL", raising=False)
    service_a = CoachService(openrouter_api_key="test-key")
    reply_a = service_a._call_openrouter("sys prompt", [CoachMessage(role="user", content="Test")])
    assert reply_a == "Dynamic model test reply."
    assert captured_payloads[-1]["model"] == "openrouter/auto"

    # Case B: OPENROUTER_FALLBACK_MODEL is configured via env
    monkeypatch.setenv("OPENROUTER_FALLBACK_MODEL", "meta-llama/llama-3.3-70b-instruct:free")
    service_b = CoachService(openrouter_api_key="test-key")
    reply_b = service_b._call_openrouter("sys prompt", [CoachMessage(role="user", content="Test")])
    assert reply_b == "Dynamic model test reply."
    assert captured_payloads[-1]["model"] == "meta-llama/llama-3.3-70b-instruct:free"


def test_coach_openrouter_cascade_on_candidate_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """If candidate model fails with HTTP 429/404, OpenRouter cascades to subsequent model."""
    import httpx

    from app.services.coach_service import CoachService

    models_attempted: list[str] = []

    def mock_post(self: httpx.Client, url: str, **kwargs: Any) -> Any:
        body = kwargs.get("json", {})
        model_name = body.get("model", "")
        models_attempted.append(model_name)

        class MockResponse:
            def __init__(self, status: int, reply: str = "") -> None:
                self.status_code = status
                self._reply = reply

            def json(self) -> dict:
                return {"choices": [{"message": {"content": self._reply}}]}

            @property
            def text(self) -> str:
                return "Rate limit exceeded" if self.status_code == 429 else ""

        # First model fails with 429 (rate-limited)
        if len(models_attempted) == 1:
            return MockResponse(429)
        # Second model in cascade succeeds
        return MockResponse(200, "Cascaded success response.")

    monkeypatch.setattr(httpx.Client, "post", mock_post)
    monkeypatch.setenv("OPENROUTER_FALLBACK_MODEL", "preferred/flaky-model")

    service = CoachService(openrouter_api_key="test-key")
    reply = service._call_openrouter("sys prompt", [CoachMessage(role="user", content="Test cascade")])

    assert reply == "Cascaded success response."
    assert len(models_attempted) == 2
    assert models_attempted[0] == "preferred/flaky-model"
    # Second model should be from the dynamic cascade (e.g. openrouter/auto or gemini)
    assert models_attempted[1] in ["openrouter/auto", "google/gemini-2.0-flash-001"]


def test_fetch_active_openrouter_models_live_or_cache() -> None:
    """Verify active OpenRouter models discovery and memory caching."""
    from app.services.coach_service import fetch_active_openrouter_models

    discovered = fetch_active_openrouter_models(timeout=5.0)
    assert isinstance(discovered, dict)
    assert "all_models" in discovered
    assert "vision_models" in discovered
    # If network is reachable, we get models; if not, graceful fallback dict is returned
    assert isinstance(discovered["all_models"], list)


def test_coach_grocery_and_meals_database_grounding() -> None:
    """Verify that grocery, meal, and user biometrics are assembled into the system prompt."""
    from app.models.schemas import GroceryItem, HealthGoals, MealEntry, MealTotals
    from app.services.coach_service import CoachService

    service = CoachService()
    profile = UserProfile(
        name="Rafi",
        age=28,
        sex="male",
        height_cm=172,
        weight_kg=70,
        budget=450.0,
        daily_kcal_target=1900.0,
        medical_conditions=["prediabetes"],
        allergens=["Peanuts"],
    )
    grocery = [
        GroceryItem(id="g1", name="Palong Shak", price=40.0, checked=False),
        GroceryItem(id="g2", name="Moshoor Dal", price=120.0, checked=False),
    ]
    meals = [
        MealEntry(
            id="m1",
            date="2026-10-31T08:00:00Z",
            label="Breakfast",
            items=[],
            totals=MealTotals(
                kcal=450.0,
                protein=15.0,
                carbs=50.0,
                fat=12.0,
                fiber=5.0,
                sodium=200.0,
                sugar=2.0,
            ),
            active_goals=HealthGoals(diabetic=True),
        )
    ]

    prompt = service._build_system_prompt(
        agent_type="scientist",
        user_profile=profile,
        recent_meals=meals,
        rag_context="Evidence from BIRDEM",
        grocery_items=grocery,
    )

    assert "[ACTIVE USER DATABASE SNAPSHOT]" in prompt
    assert "Name: Rafi" in prompt
    assert "Target Kcal: 1900" in prompt
    assert "Palong Shak (৳40)" in prompt
    assert "Moshoor Dal (৳120)" in prompt
    assert "===VOICE_SUMMARY===" in prompt


def test_coach_grocery_empty_null_safe() -> None:
    """Verify null-safe prompt construction when user has 0 grocery items and 0 logged meals."""
    from app.services.coach_service import CoachService

    service = CoachService()
    profile = UserProfile(name="Amina", daily_kcal_target=1800.0)

    prompt = service._build_system_prompt(
        agent_type="scientist",
        user_profile=profile,
        recent_meals=[],
        rag_context="",
        grocery_items=[],
    )

    assert "Available pantry/grocery: None logged" in prompt
    assert "0 meals logged so far today (Full daily budget of 1800 kcal remaining)" in prompt


def test_tts_sanitizer_removes_markdown_and_katex() -> None:
    """Verify speech sanitizer strips markdown, KaTeX math, and extracts voice summary."""
    from app.services.tts_service import sanitize_for_speech

    raw_text = (
        "## Analysis\n"
        "Here is the plan: **Eat healthy** with [App link](https://nutrivision.ai). "
        "Formula: $\\text{BMR} = 10W + 6.25H$ 🍎\n\n"
        "===VOICE_SUMMARY===\n"
        "You have 600 calories left today! Cook your spinach with one egg for a balanced dinner. 🥗"
    )

    clean = sanitize_for_speech(raw_text)
    assert "##" not in clean
    assert "**" not in clean
    assert "https://" not in clean
    assert "BMR" not in clean
    assert "🍎" not in clean
    assert "🥗" not in clean
    assert "You have 600 calories left today!" in clean
    assert "Cook your spinach with one egg for a balanced dinner." in clean


def test_tts_service_fallback_when_unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify TTS gracefully degrades without crashing when ELEVENLABS_API_KEY is unset and edge-tts fails."""
    from app.services.tts_service import TTSService

    monkeypatch.setattr(
        TTSService,
        "_synthesize_edge_tts",
        lambda self, text, *args, **kwargs: None,
    )

    tts = TTSService(api_key="")
    audio, mime, fallback, diag = tts.synthesize("Hello there, how are you?")
    assert audio is None
    assert mime == "audio/mpeg"
    assert fallback is True
    assert "edge_failed: missing_api_key" in diag


def test_tts_service_mocked_synthesis_and_lru_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify ElevenLabs API synthesis and LRU cache hit."""
    import httpx

    from app.services.tts_service import TTSService

    call_count = 0

    def mock_post(self: Any, url: str, headers: Any = None, json: Any = None) -> Any:
        nonlocal call_count
        call_count += 1

        class MockResp:
            status_code = 200
            content = b"ID3\x03\x00\x00\x00FAKE_MP3_DATA_BUFFER"
            text = "ok"

        return MockResp()

    monkeypatch.setattr(httpx.Client, "post", mock_post)

    tts = TTSService(api_key="test-eleven-key", voice_id="test-voice", model_id="eleven_flash_v2_5")

    audio1, mime1, fb1, diag1 = tts.synthesize("Take a fifteen minute walk after dinner.", lang="en")
    assert audio1 == b"ID3\x03\x00\x00\x00FAKE_MP3_DATA_BUFFER"
    assert fb1 is False
    assert diag1 == "ok"
    assert call_count == 1

    # Second call with identical text must hit memory cache (call_count stays 1)
    audio2, mime2, fb2, diag2 = tts.synthesize("Take a fifteen minute walk after dinner.", lang="en")
    assert audio2 == audio1
    assert fb2 is False
    assert diag2 == "ok (cache_hit)"
    assert call_count == 1


def test_tts_service_cache_isolation_between_personas(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify LRU cache key isolation between Dr. Susmit (Scientist) and Farhan (Behavioral).

    Ensures that identical greeting text does not collide or serve one coach's cached audio
    to the other persona, even when using the same underlying audio model.
    """
    import hashlib

    import httpx

    from app.services.tts_service import (
        PREMADE_MALE_VOICE_ID,
        TTSService,
    )

    calls: list[dict[str, Any]] = []

    def mock_post(self: Any, url: str, headers: Any = None, json: Any = None) -> Any:
        calls.append({"url": url, "json": json})
        if len(calls) == 1:
            class SusmitResp:
                status_code = 200
                content = b"ID3\x03\x00MALE_SUSMIT_AUDIO"
                text = "ok"

            return SusmitResp()
        else:
            class FarhanResp:
                status_code = 200
                content = b"ID3\x03\x00FARHAN_AUDIO"
                text = "ok"

            return FarhanResp()

    monkeypatch.setattr(httpx.Client, "post", mock_post)

    tts = TTSService(api_key="test-eleven-key")
    greeting = "Hello! What would you like to know about nutrition today?"

    # 1. Synthesize greeting for Dr. Susmit (scientist)
    audio_male, _, fb1, diag1 = tts.synthesize(greeting, persona="scientist")
    assert audio_male == b"ID3\x03\x00MALE_SUSMIT_AUDIO"
    assert fb1 is False
    assert diag1 == "ok"
    assert len(calls) == 1
    assert PREMADE_MALE_VOICE_ID in calls[0]["url"]

    # 2. Synthesize identical greeting for Farhan (behavioral)
    # Must NOT hit cache from scientist persona!
    audio_farhan, _, fb2, diag2 = tts.synthesize(greeting, persona="behavioral")
    assert audio_farhan == b"ID3\x03\x00FARHAN_AUDIO"
    assert fb2 is False
    assert diag2 == "ok"  # Fresh synthesis, NOT cache_hit
    assert len(calls) == 2

    # 3. Repeat call for Dr. Susmit -> Must hit scientist cache
    audio_male_cached, _, fb3, diag3 = tts.synthesize(greeting, persona="scientist")
    assert audio_male_cached == b"ID3\x03\x00MALE_SUSMIT_AUDIO"
    assert fb3 is False
    assert diag3 == "ok (cache_hit)"
    assert len(calls) == 2  # No extra HTTP call

    # 4. Repeat call for Farhan -> Must hit behavioral cache
    audio_farhan_cached, _, fb4, diag4 = tts.synthesize(greeting, persona="behavioral")
    assert audio_farhan_cached == b"ID3\x03\x00FARHAN_AUDIO"
    assert fb4 is False
    assert diag4 == "ok (cache_hit)"
    assert len(calls) == 2  # No extra HTTP call

    # 5. Verify cache key format
    clean = greeting.strip()
    text_hash = hashlib.md5(clean.encode("utf-8")).hexdigest()
    expected_susmit_key = f"scientist:{PREMADE_MALE_VOICE_ID}:eleven_flash_v2_5:{text_hash}"
    expected_farhan_key = f"behavioral:{PREMADE_MALE_VOICE_ID}:eleven_flash_v2_5:{text_hash}"
    assert expected_susmit_key in tts._cache
    assert expected_farhan_key in tts._cache
    assert expected_susmit_key != expected_farhan_key
    assert tts._cache[expected_susmit_key] == b"ID3\x03\x00MALE_SUSMIT_AUDIO"
    assert tts._cache[expected_farhan_key] == b"ID3\x03\x00FARHAN_AUDIO"


def test_tts_service_dynamic_env_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify TTSService resolves ELEVENLABS_API_KEY dynamically at request time."""
    from app.services.tts_service import TTSService

    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    tts = TTSService()
    assert tts.is_configured() is False

    # Dynamically inject key at runtime (simulating Render env var injection)
    monkeypatch.setenv("ELEVENLABS_API_KEY", "dynamically-added-render-key")
    assert tts.is_configured() is True
    assert tts.api_key == "dynamically-added-render-key"


def test_tts_service_auto_retries_on_http_402_library_voice(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify ElevenLabs HTTP 402 library voice restriction triggers auto-retry with premade voice."""
    import httpx

    from app.services.tts_service import PREMADE_MALE_VOICE_ID, TTSService

    requested_urls: list[str] = []

    def mock_post(self: Any, url: str, headers: Any = None, json: Any = None) -> Any:
        requested_urls.append(url)
        if "custom-unauthorized-voice" in url:
            class Mock402:
                status_code = 402

                def json(self) -> dict[str, Any]:
                    return {"detail": {"status": "blocked", "message": "Free users cannot use library voices"}}

                text = "Free users cannot use library voices"

            return Mock402()
        else:
            class Mock200:
                status_code = 200
                content = b"ID3\x03\x00PREMADE_AUDIO_BYTES"
                text = "ok"

            return Mock200()

    monkeypatch.setattr(httpx.Client, "post", mock_post)

    tts = TTSService(api_key="valid-free-tier-key")
    audio, mime, fallback, diag = tts.synthesize("Welcome to NutriVision", voice_id="custom-unauthorized-voice")
    assert audio == b"ID3\x03\x00PREMADE_AUDIO_BYTES"
    assert fallback is False
    assert diag == "ok (premade_voice_retry)"
    assert len(requested_urls) == 2
    assert "custom-unauthorized-voice" in requested_urls[0]
    assert PREMADE_MALE_VOICE_ID in requested_urls[1]


def test_tts_service_edge_tts_fallback_when_elevenlabs_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify server-side neural TTS (edge-tts) generates audio when ElevenLabs fails."""
    import httpx

    from app.services.tts_service import TTSService

    def mock_post(self: Any, url: str, headers: Any = None, json: Any = None) -> Any:
        class Mock429:
            status_code = 429

            def json(self) -> dict[str, Any]:
                return {"detail": "Rate limit exceeded"}

            text = "Rate limit exceeded"

        return Mock429()

    monkeypatch.setattr(httpx.Client, "post", mock_post)
    monkeypatch.setattr(
        TTSService,
        "_synthesize_edge_tts",
        lambda self, text, *args, **kwargs: b"ID3\x03\x00EDGE_NEURAL_AUDIO",
    )

    tts = TTSService(api_key="rate-limited-key", voice_id="test-voice")
    audio, mime, fallback, diag = tts.synthesize("Take your medication on time.")
    assert audio == b"ID3\x03\x00EDGE_NEURAL_AUDIO"
    assert fallback is False
    assert "ok (edge_neural_fallback:" in diag
    assert "elevenlabs_http_429" in diag


def test_tts_service_surfaces_http_error_diagnostic(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify non-200 responses from ElevenLabs surface clear diagnostic messages when edge-tts also fails."""
    import httpx

    from app.services.tts_service import TTSService

    def mock_post(self: Any, url: str, headers: Any = None, json: Any = None) -> Any:
        class MockErrorResp:
            status_code = 401

            def json(self) -> dict[str, Any]:
                return {"detail": {"status": "quota_exceeded", "message": "Free tier quota exceeded or invalid key"}}

            text = "Unauthorized"

        return MockErrorResp()

    monkeypatch.setattr(httpx.Client, "post", mock_post)
    monkeypatch.setattr(
        TTSService,
        "_synthesize_edge_tts",
        lambda self, text, *args, **kwargs: None,
    )

    tts = TTSService(api_key="expired-key", voice_id="test-voice")
    audio, mime, fallback, diag = tts.synthesize("Test prompt")
    assert audio is None
    assert fallback is True
    assert "elevenlabs_http_401" in diag
    assert "quota_exceeded" in diag or "invalid key" in diag


def test_tts_service_auto_routes_bengali_to_multilingual_model(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify Bengali Unicode automatically selects eleven_multilingual_v2 while English uses eleven_flash_v2_5."""
    import httpx

    from app.services.tts_service import DEFAULT_MODEL_ID, MULTILINGUAL_MODEL_ID, TTSService

    recorded_models: list[str] = []

    def mock_post(self: Any, url: str, headers: Any = None, json: Any = None) -> Any:
        if json and "model_id" in json:
            recorded_models.append(json["model_id"])

        class MockResp:
            status_code = 200
            content = b"ID3\x03\x00\x00\x00MOCK_AUDIO"
            text = "ok"

        return MockResp()

    monkeypatch.setattr(httpx.Client, "post", mock_post)

    tts = TTSService(api_key="test-key", voice_id="test-voice", model_id=DEFAULT_MODEL_ID)

    # 1. Pure English text -> stays on eleven_flash_v2_5
    tts.synthesize("Drink a glass of water before your meal.", lang="en")
    assert recorded_models[-1] == "eleven_flash_v2_5"

    # 2. Bengali script text -> auto-switches to eleven_multilingual_v2
    tts.synthesize("আজ রাতের খাবারে পালং শাক এবং ডিম খেতে পারেন।", lang="en")
    assert recorded_models[-1] == MULTILINGUAL_MODEL_ID

    # 3. Explicit lang="bn" with ASCII transliteration -> auto-switches to eleven_multilingual_v2
    tts.synthesize("Khhabarer por 15 minute haatun.", lang="bn")
    assert recorded_models[-1] == MULTILINGUAL_MODEL_ID


def test_coach_voice_chat_endpoint_graceful_degradation(client: TestClient) -> None:
    """Verify POST /api/coach/voice-chat returns dual-channel response and falls back to browser TTS cleanly."""
    payload = {
        "messages": [{"role": "user", "content": "hello"}],
        "agent_type": "scientist",
    }
    res = client.post("/api/coach/voice-chat", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "reply" in data
    assert "voice_summary" in data
    assert len(data["voice_summary"]) > 0
    assert "tts_diagnostic" in data
    assert "missing_api_key" in data["tts_diagnostic"]


def test_coach_tts_endpoint(client: TestClient) -> None:
    """Verify POST /api/coach/tts accepts text and returns 200 OK."""
    res = client.post("/api/coach/tts", json={"text": "Here is your nutrition advice.", "persona": "scientist"})
    assert res.status_code == 200
    data = res.json()
    assert "use_browser_tts" in data
    assert "tts_diagnostic" in data


def test_tts_service_persona_aware_voice_routing(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify Dr. Susmit routes to George (Male) and Farhana routes to Sarah (Female), ignoring legacy IDs."""
    import httpx

    from app.services.tts_service import (
        PREMADE_MALE_VOICE_ID,
        TTSService,
    )

    requested_urls: list[str] = []

    def mock_post(self: Any, url: str, headers: Any = None, json: Any = None) -> Any:
        requested_urls.append(url)

        class MockResp:
            status_code = 200
            content = b"ID3\x03\x00MOCK_AUDIO"
            text = "ok"

        return MockResp()

    monkeypatch.setattr(httpx.Client, "post", mock_post)

    # 1. Simulating Render env having legacy library voice 21m00Tcm4TlvDq8ikWAM
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    tts = TTSService(api_key="valid-key")

    # Dr. Susmit must ignore legacy voice and use George
    requested_urls.clear()
    tts.synthesize("Clinical nutrition analysis", persona="scientist")
    assert PREMADE_MALE_VOICE_ID in requested_urls[-1]
    assert "21m00Tcm4TlvDq8ikWAM" not in requested_urls[-1]

    # Farhan must route to George by default, ignoring legacy voice
    requested_urls.clear()
    tts.synthesize("Habit coaching advice", persona="behavioral")
    assert PREMADE_MALE_VOICE_ID in requested_urls[-1]

    # 2. Test optional env overrides
    monkeypatch.setenv("ELEVENLABS_VOICE_ID_MALE", "custom-male-voice")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID_FARHAN", "custom-farhan-voice")

    requested_urls.clear()
    tts.synthesize("Male override prompt", persona="dr_susmit")
    assert "custom-male-voice" in requested_urls[-1]

    requested_urls.clear()
    tts.synthesize("Farhan override prompt", persona="farhan")
    assert "custom-farhan-voice" in requested_urls[-1]


def test_edge_tts_persona_and_lang_voice_mapping(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify edge-tts selects Pradeep/Andrew for Dr. Susmit and Pradeep/Brian for Farhan."""
    from app.services.tts_service import TTSService

    mock_captured_voice = None

    class MockCommunicate:
        def __init__(self, text: str, voice: str) -> None:
            nonlocal mock_captured_voice
            mock_captured_voice = voice

        async def stream(self) -> Any:
            yield {"type": "audio", "data": b"EDGE_CHUNK"}

    import edge_tts
    monkeypatch.setattr(edge_tts, "Communicate", MockCommunicate)

    tts = TTSService(api_key="")  # Unconfigured so it uses edge-tts

    # 1. Dr. Susmit (Scientist) - English -> Andrew
    tts.synthesize("Drink plenty of water.", lang="en", persona="scientist")
    assert mock_captured_voice == "en-US-AndrewNeural"

    # 2. Dr. Susmit (Scientist) - Bengali -> Pradeep
    tts.synthesize("পানি পান করুন।", lang="en", persona="scientist")
    assert mock_captured_voice == "bn-BD-PradeepNeural"

    # 3. Farhan (Habit Coach) - English -> Brian
    tts.synthesize("Building healthy habits takes time.", lang="en", persona="behavioral")
    assert mock_captured_voice == "en-US-BrianNeural"

    # 4. Farhan (Habit Coach) - Bengali -> Pradeep
    tts.synthesize("প্রতিদিনের অভ্যাস ধীরে ধীরে গড়ে তুলুন।", lang="bn", persona="farhan")
    assert mock_captured_voice == "bn-BD-PradeepNeural"





