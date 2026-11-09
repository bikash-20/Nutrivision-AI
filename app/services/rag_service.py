"""ChromaDB Multi-Collection RAG Service for NutriVision AI.

Manages 4 distinct domain collections:
  1. `bd_recipes_and_hidden_ingredients`
  2. `clinical_nutrition_guidelines`
  3. `bd_market_and_seasonal_produce`
  4. `packaged_food_facts_bd`

Provides auto-seeding on startup, vector embeddings via ChromaDB's default
embedding function or metadata filtering, and authoritative citation generation.
"""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

log = logging.getLogger(__name__)

DEFAULT_RAG_CHROMA_PATH = "app/cache/rag_chroma"
RAGCollectionName = Literal[
    "bd_recipes_and_hidden_ingredients",
    "clinical_nutrition_guidelines",
    "bd_market_and_seasonal_produce",
    "packaged_food_facts_bd",
]


class RAGServiceUnavailable(RuntimeError):
    """Raised when the knowledge base cannot serve a retrieval request."""


class RAGChunk(BaseModel):
    id: str
    document: str
    metadata: dict[str, Any]
    distance: float | None = None
    citation: str = ""


class RAGQueryRequest(BaseModel):
    query: str
    collection_name: RAGCollectionName
    filters: dict[str, Any] | None = None
    top_k: int = Field(default=3, ge=1, le=10)

    @field_validator("query")
    @classmethod
    def normalize_query(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Query must not be empty.")
        if len(normalized) > 1000:
            raise ValueError("Query must be at most 1000 characters.")
        return normalized


class RAGQueryResponse(BaseModel):
    query: str
    collection: str
    results: list[RAGChunk]


# ── Seed Documents for the 4 Collections ───────────────────────────────────

COLLECTION_SEEDS: dict[str, list[dict[str, Any]]] = {
    "bd_recipes_and_hidden_ingredients": [
        {
            "id": "recipe-shorshe-ilish",
            "document": (
                "পদ্মার সর্ষে ইলিশ (Shorshe Ilish): Authentic Hilsa fish steak cooked in freshly ground "
                "mustard paste, green chilies, and pure mustard oil. High in natural omega-3 fatty acids "
                "(EPA/DHA). Hidden factors: Ground mustard seeds add ~180mg natural sodium per serving; "
                "sharp pungency comes from allyl isothiocyanate. Glycemic Load: < 0.1 (negligible). "
                "Serving size: 160g."
            ),
            "metadata": {
                "dish_name": "Shorshe Ilish",
                "dish_name_bn": "সর্ষে ইলিশ",
                "cooking_medium": "Mustard oil",
                "glycemic_rating": "very_low",
                "clinical_tag": "high_protein_omega3",
                "citation": "INFS / Bangladesh Traditional Culinary Compendium",
            },
        },
        {
            "id": "recipe-bhuna-khichuri",
            "document": (
                "ভুনা খিচুড়ি (Bhuna Khichuri): Aromatic Chinigura rice and roasted Moong dal slow-cooked "
                "with whole spices, ginger, and ghee. High carbohydrate density (~54g carbs per 200g serving). "
                "Cooking medium: Ghee and mustard oil. Glycemic Load: High (~24 per portion). Hidden factors: "
                "Ghee adds 12g saturated fat per serving."
            ),
            "metadata": {
                "dish_name": "Bhuna Khichuri",
                "dish_name_bn": "ভুনা খিচুড়ি",
                "cooking_medium": "Ghee / Mustard oil",
                "glycemic_rating": "high",
                "clinical_tag": "diabetic_caution",
                "citation": "INFS / Bangladesh Traditional Culinary Compendium",
            },
        },
        {
            "id": "recipe-kacchi-biryani",
            "document": (
                "পুরান ঢাকার কাচ্চি বিরিয়ানি (Old Dhaka Kacchi Biryani): Marinated raw mutton layered with "
                "spiced potatoes and basmati/chinigura rice. Extremely energy dense: ~780 kcal per 320g portion. "
                "High saturated fat from mutton marrow and ghee. Hidden elements: Fried onions (beresta), "
                "added raisins, sugar in marinade, and sodium (~720mg)."
            ),
            "metadata": {
                "dish_name": "Kacchi Biryani",
                "dish_name_bn": "কাচ্চি বিরিয়ানি",
                "cooking_medium": "Ghee / Animal fat",
                "glycemic_rating": "high",
                "clinical_tag": "hyperlipidemia_caution",
                "citation": "INFS / Bangladesh Traditional Culinary Compendium",
            },
        },
        {
            "id": "recipe-rui-macher-jhol",
            "document": (
                "রুই মাছের পাতলা ঝোল (Rui Macher Patla Jhol): Rohu fish cooked in a light cumin, ginger, "
                "and turmeric stew with raw papaya and potatoes. Ideal for diabetic and cardiovascular wellness. "
                "Cooking medium: Cold-pressed mustard oil. Moderate sodium (~220mg). Glycemic Load: Low (8). "
                "Portion: 220g."
            ),
            "metadata": {
                "dish_name": "Rui Macher Jhol",
                "dish_name_bn": "রুই মাছের ঝোল",
                "cooking_medium": "Mustard oil",
                "glycemic_rating": "low",
                "clinical_tag": "cardio_friendly",
                "citation": "BIRDEM Dietary Guide for Bangladeshi Diabetics",
            },
        },
        {
            "id": "recipe-dim-bhaji",
            "document": (
                "ডিম ভাজি (Dim Bhaji / Bangladeshi Omelette): Farm egg whisked with sliced shallots, "
                "green chilies, salt, and shallow fried in mustard oil. 6.5g complete protein per egg. "
                "Hidden factors: Oil absorption ranges between 8-12g depending on pan temperature."
            ),
            "metadata": {
                "dish_name": "Dim Bhaji",
                "dish_name_bn": "ডিম ভাজি",
                "cooking_medium": "Mustard oil / Soybean oil",
                "glycemic_rating": "zero",
                "clinical_tag": "high_protein",
                "citation": "INFS Food Composition Table for Bangladesh",
            },
        },
        {
            "id": "recipe-masoor-dal",
            "document": (
                "মসুর ডাল (Masoor Dal / Red Lentil Soup): Split red lentils boiled with turmeric and tempered "
                "(phoron) with garlic, dry red chili, and onions in mustard oil. Delivers 8g plant protein "
                "and 4.2g soluble fiber per 150ml bowl. Low glycemic impact (GL: ~6)."
            ),
            "metadata": {
                "dish_name": "Masoor Dal",
                "dish_name_bn": "মসুর ডাল",
                "cooking_medium": "Mustard oil",
                "glycemic_rating": "low",
                "clinical_tag": "diabetic_friendly",
                "citation": "INFS Food Composition Table for Bangladesh",
            },
        },
        {
            "id": "infs_bhorta_01",
            "document": (
                "Traditional Bangladeshi Alu Bhorta (Mashed Potatoes) contains high glycemic carbohydrates. "
                "When prepared commercially or in restaurants, it often contains hidden high sodium from added "
                "salt and saturated fats from excessive mustard oil (approx 200-300mg sodium per 100g serving)."
            ),
            "metadata": {
                "source": "INFS/ICMR",
                "dish_type": "bhorta",
                "hidden_risks": "sodium, high_gi",
                "citation": "INFS/ICMR",
            },
        },
        {
            "id": "infs_biryani_01",
            "document": (
                "Kacchi or Chicken Biryani is a calorie-dense dish. A standard 300g serving contains approx "
                "600-800 kcal. Hidden risks include high saturated fat from Ghee/Dalda and high sodium from "
                "commercial spice mixes. Not recommended for daily consumption for diabetic or hypertensive profiles."
            ),
            "metadata": {
                "source": "INFS/ICMR",
                "dish_type": "biryani",
                "hidden_risks": "saturated_fat, sodium, high_calorie",
                "citation": "INFS/ICMR",
            },
        },
    ],
    "clinical_nutrition_guidelines": [
        {
            "id": "ada_diabetic_01",
            "document": (
                "Diabetic patients should aim for 45-60g of net carbohydrates per meal. High Glycemic Index (GI) "
                "foods like White Rice or Refined Flour (Maida) should be pivoted to Low GI alternatives like "
                "Red Rice (Lal Chal), Oats, or Whole Wheat (Atta) to prevent blood sugar spikes."
            ),
            "metadata": {
                "source": "ADA Guidelines",
                "target_profile": "diabetic",
                "type": "clinical_rule",
                "citation": "ADA Guidelines",
            },
        },
        {
            "id": "who_htn_01",
            "document": (
                "To manage hypertension, daily sodium intake must remain under 2000mg. A single meal should not "
                "exceed 600-700mg of sodium. Avoid hidden sodium in pickles (Achar), tasting salt (MSG), and commercial sauces."
            ),
            "metadata": {
                "source": "WHO Guidelines",
                "target_profile": "hypertension",
                "type": "clinical_rule",
                "citation": "WHO Guidelines",
            },
        },
        {
            "id": "guideline-birdem-rice-portion",
            "document": (
                "BIRDEM Diabetic Rice & Carbohydrate Standard: Individuals with Type 2 diabetes or "
                "prediabetes should strictly limit plain white rice (Miniket/Nazirshail) to 120-150g cooked "
                "weight per meal (approx 35-40g net carbs). Swapping 50% of rice with non-starchy leafy greens "
                "(Palong, Lal Shak) or unpolished brown rice (Lal Chal) reduces peak glucose by 40%."
            ),
            "metadata": {
                "clinical_tag": "diabetic",
                "authority": "BIRDEM / INFS",
                "target_condition": "diabetes_t2",
                "citation": "BIRDEM / INFS Diabetes Protocol (2024)",
            },
        },
        {
            "id": "guideline-who-sodium-hypertension",
            "document": (
                "WHO Sodium Restriction for Hypertension: Adults with elevated blood pressure or hypertension "
                "must restrict daily sodium to < 1500-2000mg (< 5g salt). Bangladeshi meals typically exceed "
                "this due to added table salt (kacha labon) and salted gravies. Avoid drinking cooking gravy "
                "and restrict pickled items (achar)."
            ),
            "metadata": {
                "clinical_tag": "hypertension",
                "authority": "WHO / Bangladesh Heart Foundation",
                "target_condition": "hypertension",
                "citation": "WHO / BHF Clinical Sodium Guidelines",
            },
        },
        {
            "id": "guideline-icmr-macro-split",
            "document": (
                "ICMR South Asian Dietary Guidelines: South Asian populations display higher abdominal adiposity "
                "and insulin resistance at lower BMI thresholds. Recommended macronutrient distribution: "
                "Carbohydrates 45-50%, Proteins 20-25% (1.0-1.2g/kg body weight), Fats 25-30% with minimal "
                "industrial trans fats. Target daily dietary fiber >= 35g."
            ),
            "metadata": {
                "clinical_tag": "macro_split",
                "authority": "ICMR-NIN",
                "target_condition": "general_metabolic",
                "citation": "ICMR-NIN South Asian Dietary Guidelines",
            },
        },
        {
            "id": "guideline-kdoqi-renal-protein",
            "document": (
                "KDOQI Renal Nutrition Guidelines: Individuals with impaired kidney function (eGFR < 60) "
                "require dietary protein control at 0.6-0.8g/kg/day to minimize glomerular hyperfiltration, "
                "paired with strict sodium and phosphorus monitoring from preserved or processed foods."
            ),
            "metadata": {
                "clinical_tag": "renal",
                "authority": "National Kidney Foundation / KDOQI",
                "target_condition": "kidney",
                "citation": "KDOQI Clinical Practice Guidelines for Renal Nutrition",
            },
        },
    ],
    "bd_market_and_seasonal_produce": [
        {
            "id": "market-winter-vegetables",
            "document": (
                "Winter Harvest (শীতকালীন শাকসবজি): November to February brings peak harvest for cauliflower "
                "(Phulkopi ৳35-45/pc), cabbage (Badhakopi ৳30-40/pc), country flat beans (Shim ৳60-75/kg), "
                "spinach (Palong Shak ৳20-25/bundle), cucumber (Deshi Shosha ৳39/500g), and fresh tomatoes (৳90-100/kg; Chaldal live: ৳99/500g). Best seasonal window "
                "for low-cost, high-fiber, low-calorie dietary pivots."
            ),
            "metadata": {
                "season": "winter",
                "category": "produce",
                "market": "Dhaka / Kawran Bazar",
                "citation": "DAM (Department of Agricultural Marketing) Seasonal Bulletin",
            },
        },
        {
            "id": "market-summer-produce",
            "document": (
                "Summer Harvest (গ্রীষ্মকালীন শাকসবজি): March to June features pointed gourd (Potol ৳50-65/kg), "
                "okra (Dherosh ৳55-70/kg), bitter gourd (Korola ৳70-85/kg), and bottle gourd (Lau ৳50-70/pc). "
                "High water content, excellent for blood sugar regulation and hydration."
            ),
            "metadata": {
                "season": "summer",
                "category": "produce",
                "market": "Dhaka / Kawran Bazar",
                "citation": "DAM (Department of Agricultural Marketing) Seasonal Bulletin",
            },
        },
        {
            "id": "market-tcb-staples",
            "document": (
                "TCB Benchmark Staple Prices: Miniket rice ৳68-74/kg, Lal chal (unpolished brown rice) ৳85-95/kg, "
                "Whole wheat atta ৳55-60/kg, Masoor dal fine ৳140-160/kg, Brown eggs ৳135-145/dozen, Broiler chicken "
                "৳190-210/kg, Soybean oil ৳165-175/L, Mustard oil ৳280-310/L."
            ),
            "metadata": {
                "season": "year_round",
                "category": "staples",
                "market": "TCB Benchmark",
                "citation": "Trading Corporation of Bangladesh (TCB) Daily Price Index",
            },
        },
    ],
    "packaged_food_facts_bd": [
        {
            "id": "packaged-pran-mango-frooto",
            "document": (
                "Pran Frooto Mango Fruit Drink: Sugar-sweetened beverage containing 14.2g added sucrose per 100ml. "
                "One 250ml bottle delivers ~35.5g sugar (142 kcal) with 0g fiber. Severe glycemic spike trigger."
            ),
            "metadata": {
                "brand": "Pran",
                "product_type": "beverage",
                "ultra_processed": True,
                "citation": "BSTI / Bangladesh National Food Quality Control",
            },
        },
        {
            "id": "packaged-aarong-cow-milk",
            "document": (
                "Aarong Dairy Pasteurized Pure Cow Milk: 100% natural cow milk containing 3.5% fat, 3.2g protein, "
                "and 120mg bioavailable calcium per 100ml. Free from added preservatives, sugar, or synthetic thickeners."
            ),
            "metadata": {
                "brand": "Aarong Dairy / BRAC",
                "product_type": "dairy",
                "ultra_processed": False,
                "citation": "BSTI Grade A Dairy Standard",
            },
        },
        {
            "id": "packaged-radhuni-mustard-oil",
            "document": (
                "Radhuni Pure Mustard Oil (Square Consumer Products): Cold-pressed expeller mustard oil with "
                "natural pungency. 0g sodium, 0g sugar. High in monounsaturated fats (erucic and oleic acid). "
                "Traditional culinary fat of Bengal."
            ),
            "metadata": {
                "brand": "Radhuni / Square",
                "product_type": "oil",
                "ultra_processed": False,
                "citation": "BSTI Edible Oil Quality Protocol",
            },
        },
    ],
}


class RAGService:
    """Manages multi-collection nutrition RAG using ChromaDB with auto-seeding."""

    def __init__(self, path: Path | str | None = None) -> None:
        raw = path or os.environ.get("RAG_CHROMA_PATH") or DEFAULT_RAG_CHROMA_PATH
        self.path = Path(raw)
        self.path.mkdir(parents=True, exist_ok=True)
        self._client: Any | None = None
        self._collections: dict[str, Any] = {}
        self._seeded = False
        self._lock = threading.RLock()

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        try:
            import chromadb
            from chromadb.config import Settings
            self._client = chromadb.PersistentClient(
                path=str(self.path),
                settings=Settings(anonymized_telemetry=False),
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("ChromaDB client initialization failed.")
            raise RAGServiceUnavailable("RAG vector store is unavailable.") from exc
        return self._client

    def ensure_collections(self) -> None:
        """Create and seed each curated collection before serving retrieval."""
        with self._lock:
            if self._seeded:
                return
            client = self._get_client()

            try:
                for col_name, seed_docs in COLLECTION_SEEDS.items():
                    col = client.get_or_create_collection(
                        name=col_name,
                        metadata={"hnsw:space": "cosine"},
                    )
                    self._collections[col_name] = col
                    if seed_docs:
                        col.upsert(
                            ids=[doc["id"] for doc in seed_docs],
                            documents=[doc["document"] for doc in seed_docs],
                            metadatas=[doc["metadata"] for doc in seed_docs],
                        )
                        log.info("Ensured %d seed documents in RAG collection '%s'", len(seed_docs), col_name)
            except Exception as exc:  # noqa: BLE001
                log.exception("Failed ensuring RAG collection '%s'.", col_name)
                raise RAGServiceUnavailable("RAG knowledge base initialization failed.") from exc

            self._seeded = True

    def health(self) -> dict[str, int]:
        """Ensure all curated collections are ready and return their document counts."""
        self.ensure_collections()
        try:
            counts = {name: int(self._collections[name].count()) for name in COLLECTION_SEEDS}
        except Exception as exc:  # noqa: BLE001
            log.exception("Failed reading RAG collection health.")
            raise RAGServiceUnavailable("RAG knowledge base health check failed.") from exc
        if any(count == 0 for count in counts.values()):
            raise RAGServiceUnavailable("One or more RAG collections are empty.")
        return counts

    def query(
        self,
        collection_name: RAGCollectionName,
        query_text: str,
        filters: dict[str, Any] | None = None,
        top_k: int = 3,
    ) -> list[RAGChunk]:
        """Query one of the curated knowledge collections."""
        if collection_name not in COLLECTION_SEEDS:
            raise ValueError(f"Unsupported RAG collection: {collection_name}")
        normalized_query = query_text.strip()
        if not normalized_query:
            raise ValueError("Query must not be empty.")
        if len(normalized_query) > 1000:
            raise ValueError("Query must be at most 1000 characters.")
        if not 1 <= top_k <= 10:
            raise ValueError("top_k must be between 1 and 10.")

        with self._lock:
            self.ensure_collections()
            col = self._collections[collection_name]
            try:
                kwargs: dict[str, Any] = {
                    "query_texts": [normalized_query],
                    "n_results": top_k,
                }
                if filters:
                    kwargs["where"] = filters

                res = col.query(**kwargs)
                chunks: list[RAGChunk] = []
                ids = res.get("ids", [[]])[0]
                docs = res.get("documents", [[]])[0]
                metadatas = res.get("metadatas", [[]])[0]
                distances = res.get("distances", [[]])[0] if "distances" in res else []

                for i, chunk_id in enumerate(ids):
                    doc = docs[i] if i < len(docs) else ""
                    meta = metadatas[i] if i < len(metadatas) else {}
                    dist = distances[i] if i < len(distances) else None
                    citation = meta.get("citation", "")
                    chunks.append(
                        RAGChunk(
                            id=str(chunk_id),
                            document=str(doc),
                            metadata=meta,
                            distance=float(dist) if dist is not None else None,
                            citation=str(citation),
                        )
                    )
                return chunks
            except Exception as exc:  # noqa: BLE001
                log.exception("RAG query failed on collection '%s'.", collection_name)
                raise RAGServiceUnavailable("RAG retrieval failed.") from exc


# Process-wide singleton
_rag_service: RAGService | None = None
_rag_service_lock = threading.Lock()


def get_rag_service() -> RAGService:
    global _rag_service
    with _rag_service_lock:
        if _rag_service is None:
            _rag_service = RAGService()
        return _rag_service
