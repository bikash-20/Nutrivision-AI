"""Tests for Groq vision client request construction and response parsing."""

from __future__ import annotations

import base64
import json

import httpx

from app.services.groq_client import GroqClient


def test_unconfigured_client_does_not_make_a_request() -> None:
    client = GroqClient(api_key="")
    assert client.is_configured() is False
    assert client.detect("data:image/jpeg;base64,dGVzdA==") == []


def test_detect_sends_image_and_parses_response() -> None:
    image_data = base64.b64encode(b"test food photo").decode("ascii")
    image_ref = f"data:image/jpeg;base64,{image_data}"
    seen: dict[str, object] = {}

    def respond(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth_header"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": (
                                '[{"name":"Chicken biryani","name_bn":"চিকেন বিরিয়ানি",'
                                '"confidence":95,"grams":320,"bbox":[0.1,0.2,0.5,0.6]},'
                                '{"name":"Cucumber raita","name_bn":"শসার রায়তা",'
                                '"confidence":89,"grams":100}]'
                            ),
                        }
                    }
                ]
            },
        )

    client = GroqClient(
        api_key="gsk_test_key",
        model="llama-3.2-11b-vision-preview",
        base_url="https://api.groq.com/openai/v1",
    )
    client._client = httpx.Client(transport=httpx.MockTransport(respond))
    try:
        detected = client.detect(image_ref)
    finally:
        client.close()

    assert seen["url"] == "https://api.groq.com/openai/v1/chat/completions"
    assert seen["auth_header"] == "Bearer gsk_test_key"
    body = seen["body"]
    assert isinstance(body, dict)
    assert body["model"] == "llama-3.2-11b-vision-preview"
    messages = body["messages"]
    assert len(messages) == 1
    content_parts = messages[0]["content"]
    assert len(content_parts) == 2
    assert content_parts[0]["type"] == "text"
    assert "food items" in content_parts[0]["text"]
    assert content_parts[1]["type"] == "image_url"
    assert content_parts[1]["image_url"]["url"] == image_ref

    assert len(detected) == 2
    assert detected[0].name == "Chicken biryani"
    assert detected[0].name_bn == "চিকেন বিরিয়ানি"
    assert detected[0].confidence == 95.0
    assert detected[0].grams == 320.0
    assert detected[0].bbox == (0.1, 0.2, 0.5, 0.6)
    assert detected[1].name == "Cucumber raita"
    assert detected[1].name_bn == "শসার রায়তা"
    assert detected[1].confidence == 89.0
    assert detected[1].grams == 100.0


def test_detect_tolerates_markdown_fences_and_preamble() -> None:
    client = GroqClient(api_key="gsk_test_key")

    raw_response = {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": (
                        "Here are the detected foods:\n"
                        "```json\n"
                        '[{"name": "Lentil dal", "name_bn": "ডাল", "confidence": 91, "grams": 180}]\n'
                        "```\nEnjoy your meal!"
                    ),
                }
            }
        ]
    }

    client._client = httpx.Client(
        transport=httpx.MockTransport(lambda req: httpx.Response(200, json=raw_response))
    )
    try:
        items = client.detect("data:image/jpeg;base64,dGVzdA==")
    finally:
        client.close()

    assert len(items) == 1
    assert items[0].name == "Lentil dal"
    assert items[0].name_bn == "ডাল"
    assert items[0].confidence == 91.0
    assert items[0].grams == 180.0


def test_detect_handles_http_errors_gracefully() -> None:
    client = GroqClient(api_key="gsk_test_key")
    # Simulate a 429 rate limit
    client._client = httpx.Client(
        transport=httpx.MockTransport(lambda req: httpx.Response(429, json={"error": "Rate limit exceeded"}))
    )
    try:
        items = client.detect("data:image/jpeg;base64,dGVzdA==")
    finally:
        client.close()

    assert items == []


def test_detect_parses_single_meat_object() -> None:
    client = GroqClient(api_key="gsk_test_key")
    raw_response = {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": '{"name": "Roast Beef", "name_bn": "রোস্ট বিফ", "confidence": 94, "grams": 250}',
                }
            }
        ]
    }
    client._client = httpx.Client(
        transport=httpx.MockTransport(lambda req: httpx.Response(200, json=raw_response))
    )
    try:
        items = client.detect("data:image/jpeg;base64,dGVzdA==")
    finally:
        client.close()

    assert len(items) == 1
    assert items[0].name == "Roast Beef"
    assert items[0].name_bn == "রোস্ট বিফ"
    assert items[0].confidence == 94.0
    assert items[0].grams == 250.0


def test_detect_falls_back_when_primary_model_returns_404() -> None:
    client = GroqClient(api_key="gsk_test_key", model="deprecated-preview-model")
    attempts = []

    def respond(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        attempts.append(body["model"])
        if body["model"] == "deprecated-preview-model":
            return httpx.Response(404, json={"error": "model not found"})
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": '[{"name": "Beef Steak", "confidence": 90, "grams": 200}]',
                        }
                    }
                ]
            },
        )

    client._client = httpx.Client(transport=httpx.MockTransport(respond))
    try:
        items = client.detect("data:image/jpeg;base64,dGVzdA==")
    finally:
        client.close()

    assert len(items) == 1
    assert items[0].name == "Beef Steak"
    assert len(attempts) >= 2
    assert attempts[0] == "deprecated-preview-model"

