"""Multi-Agent AI Coach Service for NutriVision AI.

Coordinates two specialized agent personas:
  1. 🔬 Culinary & Nutrition Scientist (Dr. Susmit - পুষ্টি বিজ্ঞানী):
     Grounded in BIRDEM/ADA guidelines, biochemical mechanisms, glycemic indices,
     and hidden sodium/oil calculations.
  2. 🧠 Behavioral & Habit Coach (আচরণ ও অভ্যাস কোচ):
     Grounded in CBT/habit loops, habit building, stress eating, and late-night cravings.

Resilience Provider Cascade:
  1st Attempt: Google Gemini 2.0 Flash (Primary)
  2nd Attempt: OpenRouter API Fallback (OPENROUTER_API_KEY)
  3rd Attempt: Groq Fallback (GROQ_API_KEY)
  4th Attempt: Local Context-Aware Synthesizer (Natural greetings & RAG evidence)
"""

from __future__ import annotations

import base64
import logging
import os
import re
import time
from typing import Any

import httpx

from app.models.schemas import (
    CoachAgentType,
    CoachChatRequest,
    CoachChatResponse,
    CoachMessage,
    GroceryItem,
    MealEntry,
    UserProfile,
)
from app.services.rag_service import get_rag_service
from app.services.tts_service import get_tts_service, sanitize_for_speech

log = logging.getLogger(__name__)

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models"
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

# Global in-memory cache for live active OpenRouter models (30-minute TTL)
_OPENROUTER_MODELS_CACHE: dict[str, Any] = {
    "timestamp": 0.0,
    "all_models": [],
    "vision_models": [],
    "recent_models": [],
}


def fetch_active_openrouter_models(timeout: float = 3.5) -> dict[str, list[str]]:
    """Scrape and cache live active models from OpenRouter API with a 30-min TTL."""
    global _OPENROUTER_MODELS_CACHE
    now = time.time()
    if now - _OPENROUTER_MODELS_CACHE["timestamp"] < 1800 and _OPENROUTER_MODELS_CACHE["all_models"]:
        return {
            "all_models": list(_OPENROUTER_MODELS_CACHE["all_models"]),
            "vision_models": list(_OPENROUTER_MODELS_CACHE["vision_models"]),
            "recent_models": list(_OPENROUTER_MODELS_CACHE["recent_models"]),
        }

    try:
        with httpx.Client(timeout=timeout) as client:
            res = client.get(
                OPENROUTER_MODELS_URL,
                headers={"User-Agent": "NutriVision-AI/1.0", "HTTP-Referer": "https://nutrivision.ai"},
            )
            if res.status_code == 200:
                raw_data = res.json().get("data", [])
                all_ids: list[str] = []
                vision_ids: list[str] = []

                # Sort by created timestamp descending to prioritize latest active models
                sorted_by_recent = sorted(raw_data, key=lambda m: m.get("created", 0), reverse=True)
                recent_ids: list[str] = []
                for item in sorted_by_recent:
                    mid = str(item.get("id", "")).strip()
                    if not mid:
                        continue
                    all_ids.append(mid)
                    arch = item.get("architecture") or {}
                    modalities = arch.get("input_modalities") or []
                    modality_str = str(arch.get("modality", "")).lower()
                    if "image" in modalities or "image" in modality_str:
                        vision_ids.append(mid)
                    if len(recent_ids) < 10 and not mid.endswith(":batch"):
                        recent_ids.append(mid)

                _OPENROUTER_MODELS_CACHE = {
                    "timestamp": now,
                    "all_models": all_ids,
                    "vision_models": vision_ids,
                    "recent_models": recent_ids,
                }
                log.info("Discovered %d active OpenRouter models (%d vision).", len(all_ids), len(vision_ids))
    except Exception as exc:
        log.info("OpenRouter active models query skipped: %s. Using baseline models.", exc)

    return {
        "all_models": list(_OPENROUTER_MODELS_CACHE.get("all_models", [])),
        "vision_models": list(_OPENROUTER_MODELS_CACHE.get("vision_models", [])),
        "recent_models": list(_OPENROUTER_MODELS_CACHE.get("recent_models", [])),
    }


# ── System Prompts ─────────────────────────────────────────────────────────

SCIENTIST_SYSTEM_PROMPT = """\
You are Dr. Susmit, a clinical culinary scientist specializing in South Asian and Bangladeshi nutrition at NutriVision AI. You speak fluently and naturally in Bengali and English.

RULE 1 (CRITICAL GREETING RULE):
If the user says a simple greeting or casual opener (e.g., 'hello', 'hi', 'hey', 'হ্যালো', 'সালাম', 'নমস্কার', 'কেমন আছেন'), reply briefly and warmly (e.g., 'Hello! What would you like to know about nutrition or calories today? 🔬' in English or 'হ্যালো! আজকের খাবারে পুষ্টি বা ক্যালরি নিয়ে কী জানতে চান? 🔬' in Bengali).
DO NOT give unsolicited nutritional advice or dump clinical facts unless explicitly asked!

RULE 2:
When asked about food, nutrition, cooking, or clinical conditions, base your answers on BIRDEM/ADA guidelines:
1. Ground every recommendation in biochemical and physiological mechanisms:
   - Glycemic Index (GI) and Glycemic Load (GL) dynamics per BIRDEM guidelines.
   - Lipid profiles, saturated vs polyunsaturated fats, mustard oil vs palm/soybean oil.
   - Sodium-potassium balance, vascular hypertension, and renal protein loads.
2. Deconstruct traditional cooking methods:
   - Deep frying vs shallow sauteing vs boiling/steaming.
   - Oil absorption rates (e.g. eggplant/begun bhaji absorbs up to 35% oil by weight).
   - Hidden sodium in pickles, bhortas, and restaurant stocks.
3. Be specific with numbers, gram adjustments, and evidence:
   - Recommend exact swaps (e.g. replacing 100g white rice with 60g brown rice + 40g leafy greens blunts glucose spikes by 35%).
4. Always incorporate the user's clinical profile (diabetes, hypertension, kidney disease, allergies) and daily nutrient targets.
5. Provide official citations in brackets, such as [উৎস: BIRDEM গাইডলাইন] or [উৎস: ADA Guidelines].
6. Language: If the user communicates in Bengali, respond in natural, professional, authentic Bengali script. If in English, respond in clear English.
7. Mathematical & Biochemical Formulas: Format equations cleanly in KaTeX/LaTeX syntax using $...$ for inline or $$...$$ for display equations, e.g. $GL = \\frac{GI \\times \\text{Net Carbs}}{100}$ or $\\text{BMR} = 10 \\times \\text{weight} + 6.25 \\times \\text{height} - 5 \\times \\text{age} + 5$.
"""

BEHAVIORAL_SYSTEM_PROMPT = """\
You are a Behavioral Health Coach at NutriVision AI. You speak naturally and fluently in Bengali and English.

RULE 1 (CRITICAL GREETING RULE):
If the user says 'hello', 'hi', 'হ্যালো', or greets you, respond with empathy and a short greeting (e.g., 'হ্যালো! আজকে আপনার ডায়েট ট্র্যাকিং কেমন চলছে?').
DO NOT dump advice or large lectures immediately.

RULE 2:
Focus on habit building, stress eating, and late-night cravings using CBT and habit loops (Cue → Routine → Reward):
1. Warm, non-judgmental, compassionate, and positive psychology oriented:
   - Zero guilt, zero shame, zero restrictive diet culture.
   - Eating should be enjoyable, cultural, and nourishing.
2. Culturally deeply grounded in Bangladeshi life:
   - Understands the social reality of family dawats, wedding feasts (kacchi biryani), evening tea-stall adda (cha + biscuits), and sweet cravings.
   - If a user overate or slipped up, validate their experience: "দাওয়াতে আনন্দ করে খাওয়া জীবনের অংশ, কোনো অপরাধবোধের দরকার নেই!"
   - Offer low-friction recovery habits: a 15-minute gentle post-meal walk (শতপদ), drinking warm water, or eating a fiber-rich dal/salad meal next.
3. Focus on small daily wins:
   - Rather than banning foods, add nourishing foods first ("চালের সাথে একটু বেশি সবজি যোগ করি").
   - Help overcome emotional eating and late-night cravings with mindfulness techniques.
4. Language: If the user communicates in Bengali, speak with warmth, empathy, and natural Bengali idioms. If in English, be warm, friendly, and practical.
5. Keep advice concise, encouraging, and easy to do today without special equipment or stress.
"""


def _is_greeting(text: str) -> bool:
    """Check if the user input is a greeting to avoid dumping lectures."""
    clean = text.lower().strip()
    clean = re.sub(r"[!.,?।]+", "", clean).strip()
    greetings = {
        "hello", "hi", "hey", "hola", "greetings", "good morning", "good evening", "good afternoon",
        "how are you", "how are you doing", "how r u", "whats up", "what's up",
        "হ্যালো", "হাই", "হে", "সালাম", "নমস্কার", "আদাব", "কেমন আছেন", "কেমন আছো", "শুভ সকাল", "শুভ সন্ধ্যা", "শুভ রাত্রি",
        "assalamu alaikum", "assalamualaikum", "kemon achen", "kemon acho"
    }
    return clean in greetings or any(clean == g for g in greetings)


class CoachService:
    """Multi-agent AI Coach service with Gemini, OpenRouter, and Groq cascade."""

    def __init__(
        self,
        gemini_api_key: str | None = None,
        openrouter_api_key: str | None = None,
        groq_api_key: str | None = None,
    ) -> None:
        self.gemini_key = gemini_api_key or os.environ.get("GEMINI_API_KEY", "").strip()
        self.openrouter_key = openrouter_api_key or os.environ.get("OPENROUTER_API_KEY", "").strip()
        self.openrouter_model = (
            os.environ.get("OPENROUTER_FALLBACK_MODEL")
            or os.environ.get("OPENROUTER_MODEL")
            or "openrouter/auto"
        ).strip()
        self.groq_key = groq_api_key or os.environ.get("GROQ_API_KEY", "").strip()

    def chat(
        self,
        req: CoachChatRequest,
        grocery_items: list[GroceryItem] | None = None,
    ) -> CoachChatResponse:
        """Route coach chat through RAG enrichment, provider cascade, and response synthesis."""
        # Normalize messages list from request
        messages = list(req.messages or [])
        if not messages and req.message:
            for h in req.history or []:
                if isinstance(h, CoachMessage):
                    messages.append(h)
                elif isinstance(h, dict):
                    messages.append(CoachMessage(**h))
            messages.append(CoachMessage(role="user", content=req.message))

        agent_type: CoachAgentType = (
            "scientist"
            if req.agent_type == "scientist"
            else ("behavioral" if req.agent_type == "behavioral" else "coach")
        )
        user_msg = self._extract_latest_user_text(messages)

        # Merge grocery items from request or explicit argument
        effective_grocery = grocery_items if grocery_items is not None else req.grocery_items

        # 0. Fast-path for simple casual greetings: guarantees instant response and strict language alignment
        if _is_greeting(user_msg):
            reply_text = self._synthesize_local_response(
                agent_type, user_msg, req.user_profile, "", lang=req.lang
            )
            prompts = self._generate_suggested_prompts(agent_type, user_msg, req.lang)
            voice_summary = sanitize_for_speech(reply_text)
            audio_base64: str | None = None
            audio_mime_type = "audio/mpeg"
            use_browser_tts = False
            tts_diagnostic: str | None = None

            if req.include_audio:
                tts = get_tts_service()
                audio_bytes, mime, fallback, diag = tts.synthesize(
                    voice_summary,
                    lang=req.lang or "en",
                    persona=req.persona or agent_type,
                )
                tts_diagnostic = diag
                if audio_bytes:
                    audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
                    audio_mime_type = mime
                else:
                    use_browser_tts = fallback

            return CoachChatResponse(
                reply=reply_text,
                voice_summary=voice_summary,
                agent_type=agent_type,
                suggested_prompts=prompts,
                citations=[],
                audio_base64=audio_base64,
                audio_mime_type=audio_mime_type,
                use_browser_tts=use_browser_tts,
                tts_diagnostic=tts_diagnostic,
            )

        # 1. RAG Enrichment
        rag_context, citations = self._retrieve_rag_context(user_msg, req.user_profile)

        # 2. Build full context payload
        system_prompt = self._build_system_prompt(
            agent_type=agent_type,
            user_profile=req.user_profile,
            recent_meals=req.recent_meals,
            rag_context=rag_context,
            grocery_items=effective_grocery,
        )

        # 3. Provider Cascade: Gemini -> OpenRouter -> Groq -> Local RAG fallback
        reply_text = self._call_gemini(system_prompt, messages)

        if not reply_text and self.openrouter_key:
            active_model = (
                os.environ.get("OPENROUTER_FALLBACK_MODEL")
                or os.environ.get("OPENROUTER_MODEL")
                or self.openrouter_model
                or "openrouter/auto"
            ).strip()
            log.info("Gemini failed/rate-limited. Cascading to OpenRouter (%s)...", active_model)
            reply_text = self._call_openrouter(system_prompt, messages)

        if not reply_text and self.groq_key:
            log.info("Cascading to Groq...")
            reply_text = self._call_groq(system_prompt, messages)

        if not reply_text:
            reply_text = self._synthesize_local_response(
                agent_type, user_msg, req.user_profile, rag_context, lang=req.lang
            )

        # Single-pass Dual-channel parsing: UI markdown vs. spoken voice summary
        detailed_markdown = reply_text
        voice_summary = ""
        if "===VOICE_SUMMARY===" in reply_text:
            parts = reply_text.split("===VOICE_SUMMARY===", 1)
            detailed_markdown = parts[0].strip()
            voice_summary = sanitize_for_speech(parts[1].strip())
        else:
            voice_summary = sanitize_for_speech(reply_text)

        # 4. Generate contextual follow-up prompt chips (matching language mode)
        suggested_prompts = self._generate_suggested_prompts(
            agent_type, user_msg, detailed_markdown, lang=req.lang
        )

        # 5. Extract or preserve citations
        final_citations = self._resolve_citations(detailed_markdown, citations)

        # 6. Optional TTS audio synthesis
        audio_base64: str | None = None
        audio_mime_type = "audio/mpeg"
        use_browser_tts = False
        tts_diagnostic: str | None = None

        if req.include_audio:
            tts = get_tts_service()
            audio_bytes, mime, fallback, diag = tts.synthesize(
                voice_summary or detailed_markdown,
                lang=req.lang or "en",
                persona=req.persona or agent_type,
            )
            tts_diagnostic = diag
            if audio_bytes:
                audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
                audio_mime_type = mime
                use_browser_tts = False
            else:
                audio_base64 = None
                use_browser_tts = fallback

        return CoachChatResponse(
            reply=detailed_markdown,
            voice_summary=voice_summary,
            citations=final_citations,
            suggested_prompts=suggested_prompts,
            agent_type=agent_type,
            audio_base64=audio_base64,
            audio_mime_type=audio_mime_type,
            use_browser_tts=use_browser_tts,
            tts_diagnostic=tts_diagnostic,
        )

    def _extract_latest_user_text(self, messages: list[CoachMessage]) -> str:
        for m in reversed(messages):
            if m.role == "user" and m.content:
                return m.content
        return ""

    def _retrieve_rag_context(
        self,
        query: str,
        profile: UserProfile | None,
    ) -> tuple[str, list[str]]:
        """Query ChromaDB domain collections for clinical or recipe evidence."""
        rag = get_rag_service()
        citations: list[str] = []
        contexts: list[str] = []

        search_terms = query.lower()
        if _is_greeting(query):
            return "", []

        collections_to_search: list[str] = []
        if any(w in search_terms for w in ["glycemic", "গ্লাইসেমিক", "ডায়াবেটিস", "blood pressure", "রক্তচাপ", "লবণ", "sodium", "কিডনি", "kidney"]):
            collections_to_search.append("clinical_nutrition_guidelines")
        if any(w in search_terms for w in ["তেল", "oil", "রান্না", "cooking", "রেসিপি", "recipe", "ইলিশ", "পোলাও", "খিচুড়ি", "বিরিয়ানি"]):
            collections_to_search.append("bd_recipes_and_hidden_ingredients")
        if any(w in search_terms for w in ["দাম", "বাজার", "price", "budget", "বাজেট", "মৌসুমি"]):
            collections_to_search.append("bd_market_and_seasonal_produce")

        if not collections_to_search:
            collections_to_search = ["clinical_nutrition_guidelines", "bd_recipes_and_hidden_ingredients"]

        for col_name in collections_to_search[:2]:
            try:
                chunks = rag.query(collection_name=col_name, query_text=query or "nutrition guidance", top_k=2)
                for chunk in chunks:
                    contexts.append(chunk.document)
                    if chunk.citation and chunk.citation not in citations:
                        citations.append(chunk.citation)
            except Exception as e:
                log.warning("RAG retrieval failed for collection %s: %s", col_name, e)

        joined_context = "\n---\n".join(contexts) if contexts else ""
        return joined_context, citations

    def _build_system_prompt(
        self,
        agent_type: CoachAgentType,
        user_profile: UserProfile | None,
        recent_meals: list[MealEntry] | None,
        rag_context: str,
        grocery_items: list[GroceryItem] | None = None,
    ) -> str:
        base = SCIENTIST_SYSTEM_PROMPT if agent_type == "scientist" else BEHAVIORAL_SYSTEM_PROMPT
        sections: list[str] = [base]

        target_kcal = 2000
        if user_profile:
            conds = ", ".join(user_profile.medical_conditions) or "none"
            allergens = ", ".join(user_profile.allergens) or "none"
            target_kcal = int(user_profile.daily_kcal_target or 2000)
            budget_str = f"৳{int(user_profile.budget)} BDT" if (user_profile.budget and user_profile.budget > 0) else "Not set"
            sections.append(
                f"\n[ACTIVE USER DATABASE SNAPSHOT]\n"
                f"- Name: {user_profile.name or 'User'}\n"
                f"- Age: {user_profile.age or 28}, Sex: {user_profile.sex or 'male'}\n"
                f"- Weight: {user_profile.weight_kg or 70} kg, Height: {user_profile.height_cm or 172} cm\n"
                f"- Goal: {user_profile.goal or 'maintain'}, Activity: {user_profile.activity_level or 'moderate'}\n"
                f"- Target Kcal: {target_kcal} kcal/day\n"
                f"- Diet: {user_profile.diet_type or 'Not set'}\n"
                f"- Medical conditions: {conds}\n"
                f"- Allergens: {allergens}\n"
                f"- Daily Food Budget: {budget_str}\n"
            )

        if recent_meals and len(recent_meals) > 0:
            meal_lines = []
            for m in recent_meals[-3:]:
                items_str = ", ".join([f"{it.name} ({it.grams}g)" for it in m.items[:4]])
                meal_lines.append(f"- {m.date[:10]} {m.label}: {items_str} [Total: {int(m.totals.kcal)} kcal]")
            sections.append("\n[RECENT LOGGED MEALS]\n" + "\n".join(meal_lines))
        else:
            sections.append(
                f"\n[RECENT LOGGED MEALS]\n"
                f"- Today's logged meals: 0 meals logged so far today (Full daily budget of {target_kcal} kcal remaining)."
            )

        if grocery_items and len(grocery_items) > 0:
            active_items = [g for g in grocery_items if not g.checked] or grocery_items
            g_lines = [f"{g.name} (৳{int(g.price)})" for g in active_items[:10]]
            sections.append(
                f"\n[AVAILABLE PANTRY & GROCERY ITEMS]\n"
                f"- Current grocery/pantry items: {', '.join(g_lines)}\n"
                f"- CRITICAL INSTRUCTION: Prioritize suggesting dishes, meal ideas, or swaps using these ingredients whenever user asks what to cook or eat."
            )
        else:
            sections.append(
                "\n[AVAILABLE PANTRY & GROCERY ITEMS]\n"
                "- Available pantry/grocery: None logged (suggest affordable local Bangladeshi staples within remaining BDT budget)."
            )

        if rag_context:
            sections.append(f"\n[AUTHORITATIVE DOMAIN EVIDENCE & RAG CITATIONS]\n{rag_context}")

        sections.append(
            "\n[DUAL-CHANNEL OUTPUT DIRECTIVE]\n"
            "Structure your reply with two sections separated by `===VOICE_SUMMARY===`:\n"
            "1. Complete, detailed advice formatted in Markdown for the chat UI (headings, bullet points, citations, and KaTeX math if relevant).\n"
            "2. Output the exact delimiter `===VOICE_SUMMARY===` followed by a concise 2-3 sentence conversational spoken summary (strictly under 60 words, in the requested language).\n"
            "CRITICAL FOR VOICE_SUMMARY: No asterisks (**), no markdown syntax, no emojis, no URLs, no KaTeX math notation, no bullet points — write plain, fluent spoken prose that sounds natural when read aloud."
        )

        return "\n".join(sections)

    def _call_gemini(self, system_prompt: str, messages: list[CoachMessage]) -> str | None:
        if not self.gemini_key:
            return None

        url = f"{GEMINI_API_URL}/gemini-2.0-flash:generateContent"
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": self.gemini_key,
        }

        gemini_contents = []
        for m in messages:
            role = "user" if m.role == "user" else "model"
            parts: list[dict[str, Any]] = []

            if m.image_ref:
                raw_b64 = m.image_ref
                mime_type = "image/jpeg"
                if "base64," in raw_b64:
                    header, _, raw_b64 = raw_b64.partition("base64,")
                    if "image/png" in header:
                        mime_type = "image/png"
                    elif "image/webp" in header:
                        mime_type = "image/webp"
                parts.append({"inline_data": {"mime_type": mime_type, "data": raw_b64}})

            parts.append({"text": m.content or "Please analyze this."})
            gemini_contents.append({"role": role, "parts": parts})

        body = {
            "system_instruction": {"parts": [{"text": system_prompt}]},
            "contents": gemini_contents,
            "generationConfig": {
                "temperature": 0.4,
                "maxOutputTokens": 800,
            },
        }

        try:
            with httpx.Client(timeout=12.0) as client:
                res = client.post(url, headers=headers, json=body)
                if res.status_code == 200:
                    data = res.json()
                    candidates = data.get("candidates", [])
                    if candidates:
                        content_parts = candidates[0].get("content", {}).get("parts", [])
                        texts = [p.get("text", "") for p in content_parts if "text" in p]
                        return "".join(texts).strip()
                log.warning("Gemini coach chat failed: %s %s", res.status_code, res.text[:200])
        except Exception as exc:
            log.warning("Gemini coach request exception: %s", exc)

        return None

    def _resolve_openrouter_model_cascade(self, has_image: bool = False) -> list[str]:
        """Construct an ordered cascade list of active OpenRouter models.

        Cascade Priority:
        1. User's explicitly configured model (via OPENROUTER_FALLBACK_MODEL or init).
        2. openrouter/auto (OpenRouter's intelligent meta-router).
        3. High-performance, active provider models:
           - google/gemini-2.0-flash-001 (or latest active flash)
           - deepseek/deepseek-chat
           - meta-llama/llama-3.3-70b-instruct
           - qwen/qwen-2.5-72b-instruct
        4. Dynamically scraped active models from OpenRouter live catalog.
        5. openrouter/free (cost-free safety net).
        """
        user_configured = (
            os.environ.get("OPENROUTER_FALLBACK_MODEL")
            or os.environ.get("OPENROUTER_MODEL")
            or self.openrouter_model
            or "openrouter/auto"
        ).strip()
        if not user_configured:
            user_configured = "openrouter/auto"

        discovered = fetch_active_openrouter_models()
        candidates: list[str] = [user_configured]

        if has_image:
            # Multimodal vision cascade (prioritize 100% free models for $0-balance keys)
            preferred_vision = [
                "google/gemma-4-31b-it:free",
                "google/gemma-4-26b-a4b-it:free",
                "nvidia/nemotron-3.5-super-vl:free",
                "openrouter/free",
                "google/gemini-2.0-flash-001",
                "meta-llama/llama-3.2-11b-vision-instruct",
                "openrouter/auto",
            ]
            candidates.extend(preferred_vision)
            # Add top active vision models dynamically discovered
            for vm in discovered.get("vision_models", [])[:5]:
                candidates.append(vm)
        else:
            # Text chat cascade (prioritize high-parameter free models like Nemotron-3-Ultra)
            preferred_text = [
                "openrouter/auto",
                "nvidia/nemotron-3-ultra-550b-a55b:free",
                "nvidia/nemotron-3.5-lightning:free",
                "openrouter/free",
                "google/gemini-2.0-flash-001",
                "deepseek/deepseek-chat",
                "meta-llama/llama-3.3-70b-instruct",
                "qwen/qwen-2.5-72b-instruct",
            ]
            candidates.extend(preferred_text)
            # Add top active recent models discovered dynamically
            for rm in discovered.get("recent_models", [])[:5]:
                candidates.append(rm)

        # Deduplicate while preserving order
        deduped: list[str] = []
        for c in candidates:
            c = c.strip()
            if c and c not in deduped:
                deduped.append(c)

        return deduped

    def _call_openrouter(self, system_prompt: str, messages: list[CoachMessage]) -> str | None:
        """Call OpenRouter API as resilient fallback with dynamic model selection and multi-model cascade."""
        if not self.openrouter_key:
            return None

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.openrouter_key}",
            "HTTP-Referer": "https://nutrivision.ai",
            "X-Title": "NutriVision AI",
        }

        has_image = any(bool(m.image_ref) for m in messages)
        cascade_models = self._resolve_openrouter_model_cascade(has_image=has_image)

        openrouter_messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
        for m in messages:
            role = "user" if m.role == "user" else "assistant"
            content: list[dict[str, Any]] | str
            if m.image_ref:
                img_url = m.image_ref
                if not img_url.startswith("data:"):
                    img_url = f"data:image/jpeg;base64,{img_url}"
                content = [
                    {"type": "text", "text": m.content or "Please analyze this image."},
                    {"type": "image_url", "image_url": {"url": img_url}},
                ]
            else:
                content = m.content
            openrouter_messages.append({"role": role, "content": content})

        for candidate_model in cascade_models:
            body = {
                "model": candidate_model,
                "messages": openrouter_messages,
                "temperature": 0.4,
                "max_tokens": 800,
            }

            try:
                with httpx.Client(timeout=12.0) as client:
                    res = client.post(OPENROUTER_API_URL, headers=headers, json=body)
                    if res.status_code == 200:
                        data = res.json()
                        choices = data.get("choices", [])
                        if choices:
                            reply = choices[0].get("message", {}).get("content", "").strip()
                            if reply:
                                log.info("OpenRouter model %s succeeded.", candidate_model)
                                return reply
                    log.warning(
                        "OpenRouter model %s returned HTTP %s: %s; cascading to next...",
                        candidate_model,
                        res.status_code,
                        res.text[:120],
                    )
            except Exception as exc:
                log.warning("OpenRouter model %s request exception: %s; cascading to next...", candidate_model, exc)

        log.warning("All OpenRouter cascade models exhausted; falling back to next provider.")
        return None

    def _call_groq(self, system_prompt: str, messages: list[CoachMessage]) -> str | None:
        if not self.groq_key:
            return None

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.groq_key}",
        }

        groq_messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
        for m in messages:
            role = "user" if m.role == "user" else "assistant"
            content: list[dict[str, Any]] | str
            if m.image_ref:
                img_url = m.image_ref
                if not img_url.startswith("data:"):
                    img_url = f"data:image/jpeg;base64,{img_url}"
                content = [
                    {"type": "text", "text": m.content or "Please analyze this image."},
                    {"type": "image_url", "image_url": {"url": img_url}},
                ]
            else:
                content = m.content
            groq_messages.append({"role": role, "content": content})

        has_image = any(bool(m.image_ref) for m in messages)
        model = "llama-3.2-11b-vision-preview" if has_image else "llama-3.3-70b-versatile"

        body = {
            "model": model,
            "messages": groq_messages,
            "temperature": 0.5,
            "max_tokens": 800,
        }

        try:
            with httpx.Client(timeout=12.0) as client:
                res = client.post(GROQ_API_URL, headers=headers, json=body)
                if res.status_code == 200:
                    data = res.json()
                    choices = data.get("choices", [])
                    if choices:
                        return choices[0].get("message", {}).get("content", "").strip()
                log.warning("Groq coach chat failed: %s %s", res.status_code, res.text[:200])
        except Exception as exc:
            log.warning("Groq coach request exception: %s", exc)

        return None

    def _is_bengali_requested(self, lang: str | None, query: str) -> bool:
        """Strict language detection honoring the UI toggle while recognizing Bengali script."""
        has_bn_chars = bool(re.search(r"[\u0980-\u09FF]", query))
        if has_bn_chars:
            return True
        if lang == "en":
            return False
        if lang == "bn":
            return True
        return False

    def _synthesize_local_response(
        self,
        agent_type: CoachAgentType,
        query: str,
        profile: UserProfile | None,
        rag_context: str,
        lang: str | None = None,
    ) -> str:
        """Intelligent local fallback if external LLMs are unavailable."""
        q_lower = query.lower()
        is_bn = self._is_bengali_requested(lang, query)

        # ── The "Hello" Fix: Natural concise greetings ──────────────────────
        if _is_greeting(query):
            if agent_type == "scientist":
                return (
                    "হ্যালো! আজকের খাবারে পুষ্টি বা ক্যালরি নিয়ে কী জানতে চান? 🔬"
                    if is_bn
                    else "Hello! What would you like to know about nutrition or calories today? 🔬"
                )
            return (
                "হ্যালো! আজকে আপনার ডায়েট ট্র্যাকিং কেমন চলছে? 💚"
                if is_bn
                else "Hello! How is your diet tracking and wellness journey going today? 💚"
            )

        if agent_type == "scientist":
            if any(w in q_lower for w in ["গ্লাইসেমিক", "glycemic", "ভাত", "rice", "কার্ব", "carb", "ডায়াবেটিস", "diabetes"]):
                if is_bn:
                    return (
                        "🔬 **বায়োকেমিক্যাল পুষ্টি বিশ্লেষণ (ড. সুস্মিত):**\n\n"
                        "রক্তে গ্লুকোজের প্রভাব নিরূপণে আমরা গ্লাইসেমিক লোড ($GL$) হিসাব করি এই সূত্রের সাহায্যে:\n\n"
                        "$$GL = \\frac{GI \\times \\text{Net Carbs (g)}}{100}$$\n\n"
                        "সাদা ভাতের (White Rice) গ্লাইসেমিক ইনডেক্স ($GI \\approx ৭৩$) তুলনামূলকভাবে বেশি। খাবার গ্রহণের পর দ্রুত গ্লুকোজ স্পাইক রোধ করতে নিচের ৩টি বৈজ্ঞানিক কৌশল অত্যন্ত কার্যকর:\n\n"
                        "• **ফাইবার বাফার সংযোজন:** প্রতি ১০০ গ্রাম ভাতের সাথে ৫০–৭০ গ্রাম শাকসবজি বা লাল শাক খেলে দ্রবণীয় ফাইবার পরিপাক গতি শ্লথ করে রক্তে শর্করা বৃদ্ধি ৩৫% পর্যন্ত রোধ করে।\n"
                        "• **রেজিস্ট্যান্ট স্টার্চ বৃদ্ধি:** ভাত রান্নার পর স্বাভাবিক তাপমাত্রায় ঠাণ্ডা করে খেলে অ্যামাইলোজের রেট্রোগ্রেডেশন ঘটে, যা প্রি-বায়োটিক রেজিস্ট্যান্ট স্টার্চে পরিণত হয় এবং গ্লাইসেমিক লোড হ্রাস করে।\n"
                        "• **প্রোটিন ও স্বাস্থ্যকর ফ্যাট:** ভাতের সাথে এক বাটি ঘন মসুর ডাল বা ইলিশ/রুই মাছের হালকা ঝোল যুক্ত করলে গ্যাস্ট্রিক এম্পটিইং টাইম দীর্ঘায়িত হয়।\n\n"
                        "[উৎস: BIRDEM ক্লিনিক্যাল গাইডলাইন ও ADA Guidelines]"
                    )
                return (
                    "🔬 **Nutritional Biochemical Analysis (Dr. Susmit):**\n\n"
                    "To evaluate the true postprandial glucose impact of carbohydrate intake, we calculate the Glycemic Load ($GL$):\n\n"
                    "$$GL = \\frac{GI \\times \\text{Net Carbs (g)}}{100}$$\n\n"
                    "White rice has a high Glycemic Index ($GI \\approx 73$). To blunt rapid postprandial glucose surges, apply these 3 scientific levers:\n\n"
                    "• **Soluble Fiber Buffer:** Pair 100g of rice with 60–80g of leafy greens (shak/vegetables) to slow alpha-amylase hydrolysis.\n"
                    "• **Retrograded Resistant Starch:** Cooling cooked rice promotes amylose recrystallization, increasing type-3 resistant starch and lowering Glycemic Load.\n"
                    "• **Protein & Lipid Partitioning:** Eating fish or thick dal prior to rice delays gastric emptying and blunts insulin peaks.\n\n"
                    "[Source: BIRDEM Clinical Protocols & ADA Guidelines]"
                )

            if any(w in q_lower for w in ["তেল", "oil", "রান্না", "ভাজি", "fry", "sodium", "লবণ", "সোডিয়াম"]):
                if is_bn:
                    return (
                        "🔬 **রান্না ও পুষ্টি উপাদান বিশ্লেষণ:**\n\n"
                        "বাংলাদেশী রান্নায় অতিরিক্ত তেল ও সোডিয়াম সাধারণত ভাজি ও ঘন মশলার গ্রেভিতে জমা হয়:\n\n"
                        "• বেগুন বা পটল ভাজি করার সময় প্রায় ৩০–৩৫% তেল শোষণ করে। ভাজার আগে সামান্য হলুদ-লবণ মাখিয়ে ৫ মিনিট রেখে পানি ঝরিয়ে নিলে তেল শোষণ অর্ধেকের নিচে নামে।\n"
                        "• সর্ষের তেল ব্যবহার করলে প্রাকৃতিকভাবে অ্যান্টি-অক্সিডেন্ট ও ওমেগা-৩ পাওয়া যায়, তবে ধোঁয়া ওঠা অতিরিক্ত তাপে গরম করা অনুচিত।\n"
                        "• কাঁচা লবণের বদলে খাবারে লেবুর রস ও কাঁচা মরিচ ব্যবহার করলে সোডিয়াম ইনটেক দৈনিক ১৫০০ মিলিগ্রামের মধ্যে রাখা সম্ভব।\n\n"
                        "[উৎস: ICMR/WHO কার্ডিওভাসকুলার সোডিয়াম গাইডলাইন]"
                    )
                return (
                    "🔬 **Culinary Biochemistry & Sodium Analysis:**\n\n"
                    "In South Asian cooking, oil absorption and sodium spikes concentrate in deep sautés and heavy gravies:\n\n"
                    "• Eggplant/vegetable fry absorbs up to 35% oil by weight. Pre-salting and draining cut oil absorption by over 50%.\n"
                    "• Cold-pressed mustard oil supplies mono-unsaturated fats and omega-3 without thermal oxidation.\n"
                    "• Substituting lemon juice and green chili for added table salt keeps daily sodium comfortably within the safe < 1500mg bracket.\n\n"
                    "[Source: WHO/ICMR Cardiovascular Dietary Guidelines]"
                )

            # Generic scientist reply
            if is_bn:
                return (
                    "🔬 **পুষ্টি বিজ্ঞানীর পরামর্শ:**\n\n"
                    "আপনার স্বাস্থ্য লক্ষ্য ও ক্লিনিক্যাল প্রোফাইল অনুযায়ী খাদ্য উপাদানগুলোর ভারসাম্য বজায় রাখা অত্যন্ত গুরুত্বপূর্ণ। "
                    "দৈনিক ক্যালোরি বাজেটের মধ্যে প্রোটিন ২৫-৩০%, জটিল কার্বোহাইড্রেট ৪৫-৫০% এবং স্বাস্থ্যকর ফ্যাট ২০-২৫% বণ্টন নিশ্চিত করুন। "
                    "প্রক্রিয়াজাত চিনি ও অতিরিক্ত লবণ পরিহার করে প্রাকৃতিক খাদ্য উপাদান গ্রহণ বিপাকীয় স্বাস্থ্য উন্নত রাখবে।\n\n"
                    "[উৎস: BIRDEM ও ADA Guidelines]"
                )
            return (
                "🔬 **Clinical Nutritionist Guidance:**\n\n"
                "According to metabolic biochemistry standards, maintain a macro balance of 25–30% protein, 45–50% unrefined complex carbs, "
                "and 20–25% healthy fats. Prioritize whole-food micronutrients while keeping added sodium under 1500mg daily.\n\n"
                "[Source: BIRDEM & ADA Guidelines]"
            )

        # Behavioral Coach
        if any(w in q_lower for w in ["দাওয়াত", "dawat", "overeat", "বেশি", "খাওয়া", "mistake", "ভুল", "অপরাধবোধ"]):
            if is_bn:
                return (
                    "🧠 **আচরণ ও অভ্যাস কোচের বার্তা:**\n\n"
                    "প্রথমেই একটি কথা মনে রাখুন: **দাওয়াতে আনন্দ করে খাওয়া কোনো অপরাধ নয়!** পারিবারিক উৎসব আমাদের সংস্কৃতির অংশ।\n\n"
                    "একটি ভারী খাবারের কারণে আপনার এতদিনের অগ্রগতি নষ্ট হয়ে যায় না। নিজেকে দোষারোপ না করে এই সহজ পদক্ষেপগুলো নিন:\n"
                    "• **হালকা হাঁটা:** খাওয়ার আধা ঘণ্টা পর ১৫–২০ মিনিট শান্তভাবে হাঁটুন (শতপদ)। এটি হজমে দারুণ সাহায্য করে।\n"
                    "• **পর্যাপ্ত পানি পান:** শরীরকে হাইড্রেটেড রাখুন। এটি সোডিয়াম ভারসাম্য ঠিক রাখতে সাহায্য করবে।\n"
                    "• **পরবর্তী খাবার স্বাভাবিক রাখুন:** না খেয়ে থাকবেন না। পরের বেলায় সাধারণ শাকসবজি বা পাতলা ডাল দিয়ে স্বাভাবিক খাবার গ্রহণ করুন।\n\n"
                    "আপনি দারুণ করছেন, ধারাবাহিকতাই আসল সাফল্য! 💚"
                )
            return (
                "🧠 **Habit Coach Perspective:**\n\n"
                "First, remember: **Enjoying a family feast or dawat is not a failure!** Food is deeply connected to family and culture.\n\n"
                "One heavy meal does not undo your health journey. Instead of guilt, try these low-friction steps:\n"
                "• **Gentle Walk:** Take a relaxed 15-minute stroll. It aids digestion and stabilizes energy.\n"
                "• **Hydrate Well:** Sip water to help flush excess sodium.\n"
                "• **Return to Rhythm:** Don't skip meals or punish yourself. Just enjoy a light, vegetable-rich meal next.\n\n"
                "Consistency over perfection is what builds lifelong vitality! 💚"
            )

        if any(w in q_lower for w in ["মিষ্টি", "sweet", "craving", "চা", "আড্ডা", "লোভ"]):
            if is_bn:
                return (
                    "🧠 **লোভ ও অভ্যাস নিয়ন্ত্রণ কৌশল:**\n\n"
                    "সন্ধ্যায় চায়ের আড্ডায় মিষ্টি বা বিস্কুটের ক্রেভিং হওয়া খুব স্বাভাবিক। একে পুরোপুরি নিষিদ্ধ না করে অভ্যাস লুপ (Habit Loop) কিছুটা পরিবর্তন করতে পারেন:\n\n"
                    "• **স্মার্ট অল্টারনেটিভ:** চিনির বদলে রং চা বা মসলা চা নিন এবং সাথে একমুঠো ভাজা চিনাবাদাম বা মুড়ি রাখতে পারেন।\n"
                    "• **১০ মিনিটের পজ:** যখনই মিষ্টি খেতে তীব্র ইচ্ছে হবে, ১০ মিনিট অপেক্ষা করুন এবং এক গ্লাস পানি পান করুন। অধিকাংশ ক্রেভিং এই সময়ে কমে যায়।\n"
                    "• **ক্ষুদ্র বিজয়:** সপ্তাহে দু-একদিন ছোট এক টুকরো মিষ্টি উপভোগ করুন সচেতনভাবে, কোনো অপরাধবোধ ছাড়া!\n\n"
                    "নিজের সাথে সদয় হোন, ধীরে ধীরে নতুন রুটিন তৈরি হবে।"
                )
            return (
                "🧠 **Managing Cravings Mindfully:**\n\n"
                "Craving sweets or biscuits during evening tea is completely normal. Don't fight it with sheer willpower—adjust the habit routine:\n\n"
                "• **Smart Pairing:** Switch to black/spice tea paired with roasted peanuts or puffed rice (muri).\n"
                "• **The 10-Minute Pause:** Wait 10 minutes and drink a glass of water when a craving strikes. Often, it subsides.\n"
                "• **Mindful Indulgence:** Savor a small portion without guilt rather than restricting until you binge.\n\n"
                "Gentle adjustments win the marathon!"
            )

        # Generic behavioral reply
        if is_bn:
            return (
                "🧠 **সুস্থ অভ্যাসের ছোট পদক্ষেপ:**\n\n"
                "স্বাস্থ্যকর জীবনযাপন কোনো কড়া নিয়মের কারাগার নয়, এটি নিজের শরীরের যত্ন নেওয়ার একটি সুন্দর উপায়। "
                "প্রতিদিন একবারে বড় পরিবর্তনের চেষ্টা না করে ছোট ছোট অভ্যাস গড়ুন—যেমন প্রতি বেলায় এক গ্লাস অতিরিক্ত পানি বা থালায় কিছু কাঁচা সালাদ যোগ করা। "
                "মনে রাখবেন, আপনার প্রতিটি সচেতন পছন্দই একটি বিজয়! আপনি আজ কোন ছোট অভ্যাসটি শুরু করতে চান?"
            )
        return (
            "🧠 **Small Daily Habit Sparks:**\n\n"
            "Healthy eating isn't about rigid restrictions; it's about making small, compassionate upgrades. "
            "Focus on adding nourishment first—like an extra glass of water or a bowl of crunchy salad before meals. "
            "Every mindful choice counts towards your long-term wellbeing!"
        )

    def _generate_suggested_prompts(
        self,
        agent_type: CoachAgentType,
        query: str,
        reply: str,
        lang: str | None = None,
    ) -> list[str]:
        """Produce 2-3 dynamic, contextual follow-up prompt chips in the active language."""
        is_bn = self._is_bengali_requested(lang, query)
        q_lower = query.lower()

        if _is_greeting(query):
            if agent_type == "scientist":
                return (
                    [
                        "আজকের খাবারের পুষ্টি ও ক্যালরি বিশ্লেষণ করুন",
                        "এই খাবারের গ্লাইসেমিক লোড কীভাবে কমাব?",
                        "বাজেট ফ্রেন্ডলি প্রোটিন উৎস কী কী?",
                    ]
                    if is_bn
                    else [
                        "Analyze calories and macros for my meal",
                        "How do I lower the glycemic load of this meal?",
                        "What are budget-friendly protein sources?",
                    ]
                )
            return (
                [
                    "দাওয়াতে অতিরিক্ত খাওয়ার পর কী করব?",
                    "রাতের মিষ্টি বা চায়ের আড্ডার লোভ কীভাবে সামলাব?",
                    "ব্যস্ত দিনে ডায়েট ঠিক রাখার সহজ কৌশল কী?",
                ]
                if is_bn
                else [
                    "How to bounce back after a heavy feast?",
                    "How to manage evening sweet cravings?",
                    "Easy routines for healthy habits on busy days?",
                ]
            )

        if agent_type == "scientist":
            if "ভাত" in q_lower or "rice" in q_lower or "glycemic" in q_lower:
                return (
                    [
                        "রান্নায় তেল শোষণ কমানোর বৈজ্ঞানিক পদ্ধতি কী?",
                        "ভাতের বিকল্প হিসেবে লাল আটার রুটি কতটা ভালো?",
                        "ডায়াবেটিসে কোন দেশীয় ফল নিরাপদে খাওয়া যায়?",
                    ]
                    if is_bn
                    else [
                        "How to reduce cooking oil absorption?",
                        "Is whole wheat atta better than white rice?",
                        "Safe fruits for blood sugar control?",
                    ]
                )
            if "oil" in q_lower or "তেল" in q_lower or "সোডিয়াম" in q_lower:
                return (
                    [
                        "সর্ষের তেল কি হৃদরোগের জন্য নিরাপদ?",
                        "খাবারে কাঁচা লবণের ঝুঁকি কমানোর সহজ উপায়?",
                        "বাজেট ফ্রেন্ডলি প্রোটিন উৎস কী কী?",
                    ]
                    if is_bn
                    else [
                        "Is mustard oil healthy for heart health?",
                        "How to limit daily sodium without losing flavor?",
                        "What are budget-friendly protein sources?",
                    ]
                )
            return (
                [
                    "এই খাবারের গ্লাইসেমিক লোড কীভাবে কমাব?",
                    "রান্নায় তেল শোষণ কমানোর বৈজ্ঞানিক পদ্ধতি কী?",
                    "ডায়াবেটিস থাকলে বিকালের নাস্তায় কী খাব?",
                ]
                if is_bn
                else [
                    "How do I lower the glycemic load of this meal?",
                    "How to reduce cooking oil absorption?",
                    "Healthy evening snack ideas for diabetics?",
                ]
            )

        # Behavioral
        if "দাওয়াতে" in q_lower or "dawat" in q_lower or "overeat" in q_lower:
            return (
                [
                    "রাতের মিষ্টি বা চায়ের আড্ডার লোভ কীভাবে সামলাব?",
                    "ব্যস্ত দিনে হেলদি ডায়েট ধরে রাখার সহজ রুটিন কী?",
                    "খাবারের পর অপরাধবোধ কাটানোর মনস্তাত্ত্বিক উপায়?",
                ]
                if is_bn
                else [
                    "How to manage evening sweet cravings?",
                    "Easy routines for healthy habits on busy days?",
                    "How to overcome guilt after overeating?",
                ]
            )
        return (
            [
                "দাওয়াতে অতিরিক্ত খাওয়ার পর কী করব?",
                "রাতের মিষ্টি বা চায়ের আড্ডার লোভ কীভাবে সামলাব?",
                "বাজেট ঠিক রেখে স্বাস্থ্যকর নাস্তা তৈরির টিপস দিন?",
            ]
            if is_bn
            else [
                "How to bounce back after a heavy feast?",
                "How to manage evening sweet cravings?",
                "Tips for healthy low-budget snacks?",
            ]
        )

    def _resolve_citations(self, reply: str, candidate_citations: list[str]) -> list[str]:
        citations = list(candidate_citations)
        found = re.findall(r"\[উৎস:\s*([^\]]+)\]", reply)
        for c in found:
            clean = c.strip()
            if clean and clean not in citations:
                citations.append(clean)

        found_en = re.findall(r"\[Source:\s*([^\]]+)\]", reply)
        for c in found_en:
            clean = c.strip()
            if clean and clean not in citations:
                citations.append(clean)

        if not citations:
            citations = ["BIRDEM ক্লিনিক্যাল গাইডলাইন", "ADA Guidelines"]

        return citations[:3]


# Module singleton
_coach_service: CoachService | None = None


def get_coach_service() -> CoachService:
    global _coach_service
    if _coach_service is None:
        _coach_service = CoachService()
    return _coach_service
