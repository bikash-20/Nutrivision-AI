"""Google Gemini vision client.

Gemini 2.0 Flash is the default model — fast, cheap, decent on food
photos. The API is `POST /v1beta/models/{model}:generateContent` with
the API key in the `x-goog-api-key` header
with a JSON body containing an `inline_data` block (base64 image) and
a prompt asking for a JSON list of detected items.

`is_configured()` is the gate the route handler uses to decide between
real Gemini and the canned fallback. If `GEMINI_API_KEY` is unset, all
calls short-circuit to `[]` so the route can degrade gracefully.

The prompt asks Gemini to return a JSON array of
`{name, name_bn, confidence (0–100), grams, bbox?}`. The handler parses that
with a tolerant regex (Gemini sometimes wraps the JSON in ``` fences).
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

import httpx

from app.models.schemas import (
    BBox,
    DetectedItem,
    MenuItemAnalysis,
    RecipeSuggestion,
    VisionDetectionResult,
)
from app.services._http_logging import log_http_failure

log = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-2.0-flash"
DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"
USER_AGENT = "NutriVisionDemo/0.1 (hackathon demo)"

# Strict multimodal prompt: supports 3-way input modes (cooked_meal, raw_ingredients, restaurant_menu),
# non-food safety gate with rejection reason, hidden ingredient inference, and recipe/menu suggestions.
_DETECTION_PROMPT = """\
You are an expert food vision, clinical nutrition, and culinary AI system.
Look at the photo and detect all food items, meat, cooked dishes, raw ingredients, beverages, or meals present.
Carefully inspect the image and determine whether it contains cooked food, raw grocery ingredients, a restaurant menu, or a non-food item.

Return ONLY a strict JSON object matching this exact schema:
{
  "is_food": true | false,
  "input_mode": "cooked_meal" | "raw_ingredients" | "restaurant_menu",
  "overall_confidence": <float 0.0 to 1.0>,
  "rejection_reason_en": "<explanation in English if is_food is false, otherwise null>",
  "rejection_reason_bn": "<explanation in Bengali if is_food is false, otherwise null>",
  "inferred_hidden_ingredients": ["<inferred cooking oils, ghee, added sugars, sodium, or thickeners likely present>"],
  "detected": [
    {
      "name": "<canonical English food name>",
      "name_bn": "<Bengali food name>",
      "confidence": <0-100 integer>,
      "grams": <estimated portion in grams>,
      "bbox": [x, y, w, h]
    }
  ],
  "recipe_suggestions": [
    {
      "title_en": "<Recipe name in English>",
      "title_bn": "<Recipe name in Bengali>",
      "description_en": "<Brief cooking instructions/overview>",
      "description_bn": "<সংক্ষিপ্ত রান্নার প্রণালী>",
      "matched_ingredients": ["<ingredient from image>"],
      "missing_ingredients": ["<ingredient needed to buy>"]
    }
  ],
  "menu_analysis": [
    {
      "dish_name_en": "<Dish on menu>",
      "dish_name_bn": "<বাংলা নাম>",
      "is_healthy_pick": true | false,
      "is_ultra_processed": true | false,
      "notes_en": "<Why healthy or why flagged>",
      "notes_bn": "<সংক্ষিপ্ত কারণ>"
    }
  ]
}

Guidelines:
1. NON-FOOD SAFETY GATE:
   - Set "is_food": false ONLY if the image unambiguously contains NO food, edible ingredients, produce, drinks, cooked meals, or restaurant menus (e.g. shoes, laptop, car, pets, furniture, documents, people without food). In that case, set "overall_confidence": 0.95, "detected": [], "rejection_reason_en": "No food detected in this photo. Please take a photo of food or ingredients.", "rejection_reason_bn": "এই ছবিতে কোনো খাবার বা উপাদান শনাক্ত করা যায়নি। অনুগ্রহ করে কোনো খাবার বা রান্নার উপাদানের ছবি তুলুন।"
   - CRITICAL FOOD BIAS: If there is ANY edible item, bowl, plate, cup, cooked meal, rice, curry, lentil/dal, vegetable, fruit, fish, meat, bread/roti, snack, beverage, or grocery item present anywhere in the photo, you MUST set "is_food": true. Pay special attention to South Asian and Bangladeshi home dishes (such as steamed rice, biryani, khichuri, chicken/beef curry, fish jhol, dal, bhaji, bhorta, shak, paratha). Never reject food due to home plating or dim lighting.
2. 3-WAY VISION MODES:
   - If cooked food / plated meal: set "input_mode": "cooked_meal", "is_food": true, detect every item in "detected", and infer cooking media (e.g., "Mustard oil", "Soybean oil", "Ghee", "Salt", "Sugar") in "inferred_hidden_ingredients". Detect dishes like khichuri / খিচুড়ি, biryani, dal, curry, meat, fish, vegetables, or rice. Keep "recipe_suggestions": [] and "menu_analysis": [] empty for cooked meals.
   - If raw ingredients / groceries (raw chicken, vegetables, lentils, spices): set "input_mode": "raw_ingredients", "is_food": true, detect items in "detected", and provide 2 healthy South Asian / Bangladeshi recipes in "recipe_suggestions" with missing ingredients to buy.
   - If a restaurant menu or printed food list: set "input_mode": "restaurant_menu", "is_food": true, extract dishes into "menu_analysis", highlight healthy picks, and flag ultra-processed or deep-fried dishes.
3. Keep `name` in concise English for database lookup; provide natural Bengali in `name_bn`.
"""


class GeminiClient:
    """Thin wrapper around the Gemini `generateContent` REST endpoint."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
    ) -> None:
        self.api_key = (
            api_key if api_key is not None else os.environ.get("GEMINI_API_KEY") or ""
        ).strip()
        self.model = model or os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL
        self.base_url = (
            base_url or os.environ.get("GEMINI_BASE_URL") or DEFAULT_BASE_URL
        ).rstrip("/")
        self._client: httpx.Client | None = None

    def _http(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                headers={"User-Agent": USER_AGENT},
                timeout=httpx.Timeout(7.0, connect=3.0),
            )
        return self._client

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    def is_configured(self) -> bool:
        """True iff a key is set — the route uses this to select a provider."""
        return bool(self.api_key)

    def detect_vision(self, image_ref: str, model_override: str | None = None) -> VisionDetectionResult | None:
        """Run multimodal vision analysis returning rich 3-way mode results."""
        if not self.is_configured():
            return None
        try:
            image_b64, mime = _read_image(image_ref)
        except (OSError, ValueError) as exc:
            log.warning("Gemini: cannot read image (%s)", type(exc).__name__)
            return None

        body = {
            "contents": [
                {
                    "parts": [
                        {"text": _DETECTION_PROMPT},
                        {
                            "inline_data": {
                                "mime_type": mime,
                                "data": image_b64,
                            }
                        },
                    ]
                }
            ],
            "generationConfig": {
                "response_mime_type": "application/json",
                "temperature": 0.1,
            },
            "safetySettings": [
                {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
            ],
        }

        target_model = model_override or self.model
        url = f"{self.base_url}/{target_model}:generateContent"
        try:
            resp = self._http().post(
                url,
                headers={"x-goog-api-key": self.api_key},
                json=body,
            )
            resp.raise_for_status()
            payload = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            log_http_failure("Gemini", exc, image_ref=image_ref)
            return None

        text = _extract_text(payload)
        if not text:
            return None
        return _parse_vision_result(text)

    def detect(self, image_ref: str) -> list[DetectedItem]:
        """Backward-compatible helper returning detected items list."""
        res = self.detect_vision(image_ref)
        return res.detected if res is not None else []


def _read_image(image_ref: str) -> tuple[str, str]:
    """Return (base64_payload, mime_type). Accepts either a data URL
    (`data:image/jpeg;base64,…`) or a local file path.

    File paths are read as JPEG by default — the frontend's
    `captureFrame()` writes canvas.toDataURL('image/jpeg', 0.92), so
    this matches reality.
    """
    if image_ref.startswith("data:"):
        # data:[<mime>];base64,<payload>
        head, _, payload = image_ref.partition(",")
        mime = head.split(":", 1)[1].split(";", 1)[0] or "image/jpeg"
        return payload, mime

    # Security check: Block path traversal and absolute system paths
    path = Path(image_ref)
    if path.is_absolute() or ".." in image_ref or not path.is_file():
        raise ValueError(f"Invalid image_ref format or inaccessible path: {image_ref}")
    suffix = path.suffix.lower()
    mime = {
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(suffix, "image/jpeg")
    return base64.b64encode(path.read_bytes()).decode("ascii"), mime


_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def _parse_gemini_response(payload: dict[str, Any]) -> list[DetectedItem]:
    """Tolerantly extract DetectedItems from a Gemini response."""
    text = _extract_text(payload)
    if not text:
        return []
    res = _parse_vision_result(text)
    return res.detected


def _parse_vision_result(text: str) -> VisionDetectionResult:
    """Parse strict JSON object with support for 3-way modes, non-food rejection, and legacy arrays."""
    text = text.strip()
    match = _JSON_FENCE_RE.search(text)
    if match:
        text = match.group(1).strip()

    parsed = None
    try:
        parsed = json.loads(text)
    except Exception:
        pass

    if parsed is None:
        start_obj = text.find("{")
        end_obj = text.rfind("}")
        if start_obj != -1 and end_obj != -1 and end_obj > start_obj:
            try:
                parsed = json.loads(text[start_obj : end_obj + 1])
            except Exception:
                pass

    if parsed is None:
        # Resilient recovery for network- or token-truncated JSON
        recovered: list[dict[str, Any]] = []
        for match in re.finditer(r'\{[^{}]*"(?:name|food|dish)"[^{}]*\}', text):
            try:
                obj = json.loads(match.group(0))
                if isinstance(obj, dict):
                    recovered.append(obj)
            except Exception:
                pass
        if recovered:
            parsed = recovered

    if parsed is None or isinstance(parsed, list):
        items = _parse_food_json(text)
        is_food = len(items) > 0
        conf = max([it.confidence / 100.0 for it in items], default=0.85) if items else 0.0
        return VisionDetectionResult(
            is_food=is_food,
            input_mode="cooked_meal",
            overall_confidence=conf,
            rejection_reason_en=None if is_food else "No food detected in photo.",
            rejection_reason_bn=None if is_food else "এই ছবিতে কোনো খাবার শনাক্ত করা যায়নি।",
            detected=items,
        )

    if isinstance(parsed, dict):
        is_food = bool(parsed.get("is_food", True))
        raw_mode = parsed.get("input_mode", "cooked_meal")
        input_mode = raw_mode if raw_mode in ("cooked_meal", "raw_ingredients", "restaurant_menu") else "cooked_meal"

        try:
            overall_confidence = float(parsed.get("overall_confidence", 0.85))
        except (TypeError, ValueError):
            overall_confidence = 0.85

        rejection_reason_en = parsed.get("rejection_reason_en")
        rejection_reason_bn = parsed.get("rejection_reason_bn")

        inferred_hidden = [str(x) for x in parsed.get("inferred_hidden_ingredients", []) if x]

        # Parse detected items
        raw_detected = parsed.get("detected") or parsed.get("items") or parsed.get("foods")
        if isinstance(raw_detected, list):
            detected_items = _parse_food_json(json.dumps(raw_detected))
        elif "name" in parsed or "food" in parsed or "dish" in parsed:
            detected_items = _parse_food_json(json.dumps([parsed]))
        else:
            detected_items = []

        if not is_food:
            detected_items = []
            if not rejection_reason_en:
                rejection_reason_en = "Non-food item detected. Please take a photo of food or ingredients."
            if not rejection_reason_bn:
                rejection_reason_bn = "খাবার হিসেবে শনাক্ত করা যায়নি। অনুগ্রহ করে কোনো খাবার বা রান্নার উপাদানের ছবি তুলুন।"

        recipe_suggestions: list[RecipeSuggestion] = []
        if isinstance(parsed.get("recipe_suggestions"), list):
            for r in parsed["recipe_suggestions"]:
                if isinstance(r, dict):
                    recipe_suggestions.append(
                        RecipeSuggestion(
                            title_en=str(r.get("title_en", "")),
                            title_bn=str(r.get("title_bn", "")),
                            description_en=str(r.get("description_en", "")),
                            description_bn=str(r.get("description_bn", "")),
                            matched_ingredients=[str(x) for x in r.get("matched_ingredients", [])],
                            missing_ingredients=[str(x) for x in r.get("missing_ingredients", [])],
                        )
                    )

        menu_analysis: list[MenuItemAnalysis] = []
        if isinstance(parsed.get("menu_analysis"), list):
            for m in parsed["menu_analysis"]:
                if isinstance(m, dict):
                    menu_analysis.append(
                        MenuItemAnalysis(
                            dish_name_en=str(m.get("dish_name_en", "")),
                            dish_name_bn=str(m.get("dish_name_bn", "")),
                            is_healthy_pick=bool(m.get("is_healthy_pick", False)),
                            is_ultra_processed=bool(m.get("is_ultra_processed", False)),
                            notes_en=str(m.get("notes_en", "")),
                            notes_bn=str(m.get("notes_bn", "")),
                        )
                    )

        return VisionDetectionResult(
            is_food=is_food,
            input_mode=input_mode,
            overall_confidence=overall_confidence,
            rejection_reason_en=rejection_reason_en,
            rejection_reason_bn=rejection_reason_bn,
            inferred_hidden_ingredients=inferred_hidden,
            recipe_suggestions=recipe_suggestions or None,
            menu_analysis=menu_analysis or None,
            detected=detected_items,
        )

    return VisionDetectionResult(
        is_food=False,
        overall_confidence=0.0,
        rejection_reason_en="Could not analyze image.",
        rejection_reason_bn="ছবিটি বিশ্লেষণ করা যায়নি।",
        detected=[],
    )



def _parse_food_json(text: str) -> list[DetectedItem]:
    """Robust parser that accepts arrays, single objects, and dict wrappers."""
    text = text.strip()
    match = _JSON_FENCE_RE.search(text)
    if match:
        text = match.group(1).strip()

    parsed = None
    try:
        parsed = json.loads(text)
    except Exception:
        pass

    if parsed is None:
        start_arr = text.find("[")
        end_arr = text.rfind("]")
        if start_arr != -1 and end_arr != -1 and end_arr > start_arr:
            try:
                parsed = json.loads(text[start_arr : end_arr + 1])
            except Exception:
                pass

    if parsed is None:
        start_obj = text.find("{")
        end_obj = text.rfind("}")
        if start_obj != -1 and end_obj != -1 and end_obj > start_obj:
            try:
                parsed = json.loads(text[start_obj : end_obj + 1])
            except Exception:
                pass

    if parsed is None:
        # Resilient recovery for network- or token-truncated JSON
        recovered: list[dict[str, Any]] = []
        for match in re.finditer(r'\{[^{}]*"(?:name|food|dish)"[^{}]*\}', text):
            try:
                obj = json.loads(match.group(0))
                if isinstance(obj, dict):
                    recovered.append(obj)
            except Exception:
                pass
        if recovered:
            parsed = recovered

    if parsed is None:
        return []

    if isinstance(parsed, dict):
        for k in ("items", "foods", "food_items", "detected", "result", "dishes"):
            if k in parsed and isinstance(parsed[k], list):
                parsed = parsed[k]
                break
        else:
            parsed = [parsed]

    if not isinstance(parsed, list):
        return []

    out: list[DetectedItem] = []
    for it in parsed:
        if not isinstance(it, dict):
            continue
        raw_name = (
            it.get("name")
            or it.get("food")
            or it.get("dish")
            or it.get("item")
            or it.get("label")
            or it.get("food_name")
            or ""
        )
        name = str(raw_name).strip()
        if not name:
            continue
        raw_bn = (
            it.get("name_bn")
            or it.get("bengali_name")
            or it.get("name_bengali")
            or ""
        )
        name_bn = str(raw_bn).strip() or None
        try:
            confidence = float(it.get("confidence", 0))
            if 0.0 < confidence <= 1.0:
                confidence *= 100.0
        except (TypeError, ValueError):
            confidence = 85.0
        try:
            grams = float(it.get("grams", 0))
            if grams <= 0:
                grams = 150.0
        except (TypeError, ValueError):
            grams = 150.0

        bbox: BBox | None = None
        raw_bbox = it.get("bbox")
        if isinstance(raw_bbox, (list, tuple)) and len(raw_bbox) == 4:
            try:
                bbox = (
                    float(raw_bbox[0]),
                    float(raw_bbox[1]),
                    float(raw_bbox[2]),
                    float(raw_bbox[3]),
                )
            except (TypeError, ValueError):
                bbox = None
        out.append(
            DetectedItem(
                name=name,
                name_bn=name_bn,
                confidence=confidence,
                grams=grams,
                bbox=bbox,
            )
        )
    return out


def _extract_text(payload: dict[str, Any]) -> str:
    """Pull the text content out of a Gemini response, logging safety blocks if encountered."""
    candidates = payload.get("candidates") or []
    if candidates:
        candidate = candidates[0] or {}
        finish_reason = candidate.get("finishReason")
        if finish_reason and finish_reason not in ("STOP", "MAX_TOKENS"):
            log.warning("Gemini candidate finishReason is %s", finish_reason)
        content = candidate.get("content") or {}
        parts = content.get("parts") or []
        if parts and isinstance(parts[0], dict):
            text = parts[0].get("text")
            if isinstance(text, str):
                return text
    text = payload.get("text")
    return text if isinstance(text, str) else ""
