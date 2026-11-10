"""Pydantic v2 schemas — 1:1 mirror of `src/types/schemas.ts`.

Lockstep rule (from `NutriVision_AI_Blueprint.md` §8):
    Any backend schema change requires the matching TS interface in
    `src/types/schemas.ts` to update in the same commit, and vice
    versa. Treat schema drift as a breaking change.

Field naming: the frontend already uses snake_case (`daily_kcal_target`,
`active_goals`, `meal_logged`), so this module is a direct port. No
alias gymnastics needed for the common case.

Where the TS surface uses inline shapes that aren't named (e.g.
`getTodaySummary()`'s return type), we lift them into named models
here (`TodaySummary`) so the FastAPI response_model is explicit.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator

# ─────────────────────────────────────────────────────────────────────────
# Core nutrition primitives
# ─────────────────────────────────────────────────────────────────────────


class NutritionFacts(BaseModel):
    """Per-100g macro/micro nutrient facts for a single food item."""

    protein: float
    carbs: float
    fat: float
    kcal: float
    fiber: float
    sodium: float
    sugar: float
    """Glycemic share, 0–1 (used by personalize filter)."""
    glycemic: float


FoodCategory = Literal["protein", "produce", "grains", "other"]


class FoodDescriptor(NutritionFacts):
    """A single food with display metadata + per-100g nutrition."""

    emoji: str
    category: FoodCategory
    """Alternative names the vision model may also emit."""
    alternatives: list[str]
    """Pairings the grocery list may suggest."""
    pairings: list[str]


# ─────────────────────────────────────────────────────────────────────────
# Vision pipeline outputs
# ─────────────────────────────────────────────────────────────────────────


# `bbox` is a fixed-length 4-tuple of normalized [x, y, w, h] floats.
BBox = tuple[float, float, float, float]


class DetectedItem(BaseModel):
    """One food item detected by the dual vision pipeline (Gemini + HF
    validator) before nutrition is resolved."""

    name: str
    """Optional Bengali display name; `name` remains canonical for nutrition lookup."""
    name_bn: str | None = None
    """Confidence 0–100; <70 is flagged low-confidence."""
    confidence: float
    """Estimated portion size in grams."""
    grams: float
    """Optional user-facing note (e.g. 'Low confidence — tap to confirm')."""
    note: str | None = None
    """Optional bounding box from the vision model [x, y, w, h] in 0–1
    normalized coordinates."""
    bbox: BBox | None = None

    @field_validator("bbox")
    @classmethod
    def _bbox_length(cls, v: BBox | None) -> BBox | None:
        """Reject malformed bounding boxes (anything other than 4 floats)."""
        if v is not None and len(v) != 4:
            raise ValueError("bbox must be exactly 4 floats: (x, y, w, h)")
        return v


class ResolvedItem(DetectedItem):
    """A `DetectedItem` after passing through the nutrition DB cascade."""

    nutrition: NutritionFacts | None = None
    descriptor: FoodDescriptor | None = None
    """Which DB resolved this item (for explainability)."""
    source: Literal[
        "open-food-facts", "usda", "fruityvice", "cache", "estimated"
    ]
    """True if the resolver only matched an 'estimated' entry."""
    partial: bool = False


# Pipeline stage + status mirrors the TS `PipelineTrace['stage'|'status']`
# literals exactly — these are also used by the frontend CaptureScreen
# toast to label each stage.
PipelineStage = Literal[
    "capture",
    "cache-check",
    "vision-id",
    "hf-validate",
    "reconcile",
    "nutrition",
    "portion",
    "personalize",
    "explain",
]
PipelineStatus = Literal[
    "pending", "running", "done", "cache-hit", "fallback"
]


class PipelineTrace(BaseModel):
    """A pipeline trace entry surfaced in a tiny toast during analysis.
    Proves the multi-stage architecture is real, not just a stub."""

    stage: PipelineStage
    status: PipelineStatus
    started_at: int
    """Wall-clock ms; matches `finishedAt` field in the TS interface."""
    finished_at: int | None = None
    label: str

    # Allow the snake_case ↔ camelCase aliases so older payloads still
    # parse while we migrate call sites. Both forms are accepted.
    model_config = ConfigDict(populate_by_name=True)


InputMode = Literal["cooked_meal", "raw_ingredients", "restaurant_menu"]
AnalysisSource = Literal[
    "hosted_vision", "vision_cache", "on_device_vision", "precomputed_reference"
]


class RecipeSuggestion(BaseModel):
    title_en: str
    title_bn: str
    description_en: str
    description_bn: str
    matched_ingredients: list[str] = Field(default_factory=list)
    missing_ingredients: list[str] = Field(default_factory=list)


class MenuItemAnalysis(BaseModel):
    dish_name_en: str
    dish_name_bn: str
    is_healthy_pick: bool = False
    is_ultra_processed: bool = False
    notes_en: str = ""
    notes_bn: str = ""


class VisionDetectionResult(BaseModel):
    is_food: bool = True
    input_mode: InputMode = "cooked_meal"
    overall_confidence: float = 0.85
    rejection_reason_en: str | None = None
    rejection_reason_bn: str | None = None
    inferred_hidden_ingredients: list[str] = Field(default_factory=list)
    recipe_suggestions: list[RecipeSuggestion] | None = None
    menu_analysis: list[MenuItemAnalysis] | None = None
    detected: list[DetectedItem] = Field(default_factory=list)


class AnalyzeResult(BaseModel):
    detected: list[DetectedItem]
    pipeline: list[PipelineTrace]
    source: AnalysisSource = "hosted_vision"
    is_food: bool = True
    input_mode: InputMode = "cooked_meal"
    overall_confidence: float = 0.85
    rejection_reason_en: str | None = None
    rejection_reason_bn: str | None = None
    inferred_hidden_ingredients: list[str] = Field(default_factory=list)
    recipe_suggestions: list[RecipeSuggestion] | None = None
    menu_analysis: list[MenuItemAnalysis] | None = None



class NutrientContribution(BaseModel):
    nutrient: Literal[
        "sodium", "sugar", "fiber", "protein", "carbs", "fat", "kcal"
    ]
    item_name: str
    amount: float
    """Share of total in this nutrient (0–1)."""
    share: float
    flagged: bool
    reason: str | None = None
    """Visual tone for the verdict chip."""
    tone: Literal["good", "warn"] | None = None


class ResolveNutritionResult(BaseModel):
    resolved: list[ResolvedItem]
    contributions: list[NutrientContribution]


# ─────────────────────────────────────────────────────────────────────────
# User profile / personalization
# ─────────────────────────────────────────────────────────────────────────


class HealthGoals(BaseModel):
    diabetic: bool = False
    protein: bool = False
    budget: bool = False
    mediter: bool = False


DietaryPreference = Literal[
    "Vegetarian",
    "Vegan",
    "Pescatarian",
    "Gluten-free",
    "Dairy-free",
    "Halal",
    "Kosher",
]

Allergen = Literal[
    "Peanuts",
    "Tree nuts",
    "Shellfish",
    "Shell shellfish",
    "Soy",
    "Eggs",
    "Dairy",
    "Gluten",
    "Sesame",
]

Sex = Literal["male", "female", "other"]
ActivityLevel = Literal["sedentary", "light", "moderate", "active", "very_active"]
GoalType = Literal["lose", "maintain", "gain"]
DietType = Literal["omnivore", "vegetarian", "vegan", "pescatarian", "halal", "kosher"]
MedicalCondition = Literal[
    "none",
    "diabetes_t1",
    "diabetes_t2",
    "prediabetes",
    "hypertension",
    "high_cholesterol",
    "kidney",
]
HeightUnit = Literal["cm", "ft_in"]
WeightUnit = Literal["kg", "lb"]


class UserProfile(BaseModel):
    name: str = ""
    age: int | None = None
    sex: Sex | None = None
    height_cm: float | None = Field(default=None, alias="heightCm")
    weight_kg: float | None = Field(default=None, alias="weightKg")
    height_unit: HeightUnit = Field(default="cm", alias="heightUnit")
    weight_unit: WeightUnit = Field(default="kg", alias="weightUnit")
    activity_level: ActivityLevel | None = Field(default=None, alias="activityLevel")
    goal: GoalType | None = None
    target_rate_kg_per_week: float | None = Field(default=None, alias="targetRateKgPerWeek")
    diet_type: DietType | None = Field(default=None, alias="dietType")
    medical_conditions: list[MedicalCondition] = Field(default_factory=list, alias="medicalConditions")
    meals_per_day: int = Field(default=3, alias="mealsPerDay")
    consent_anonymized_data: bool = Field(default=True, alias="consentAnonymizedData")
    language: str = "en"
    goals: HealthGoals = Field(default_factory=HealthGoals)
    preferences: list[DietaryPreference] = Field(default_factory=list)
    allergens: list[Allergen] = Field(default_factory=list)
    """Daily grocery budget ceiling, in local currency (BDT)."""
    budget: float | None = Field(default=None)
    """Number of people the meal serves."""
    serving: int = 1
    """Daily kcal target for the Home progress bar. Optional — older
    profiles that pre-date this field will fall back to the universal
    default (`DAILY_KCAL_TARGET_DEFAULT`)."""
    daily_kcal_target: float | None = Field(default=None, alias="dailyKcalTarget")

    model_config = ConfigDict(populate_by_name=True)


# Universal fallback daily kcal target (mirrors the TS module constant).
DAILY_KCAL_TARGET_DEFAULT: float = 2000


# ─────────────────────────────────────────────────────────────────────────
# Grocery list
# ─────────────────────────────────────────────────────────────────────────


class GroceryItem(BaseModel):
    id: str
    name: str
    category: str | None = None
    """Per-unit price in BDT."""
    price: float
    checked: bool = False


class GroceryGroup(BaseModel):
    category: str
    items: list[GroceryItem]


class GroceryList(BaseModel):
    budget: float
    groups: list[GroceryGroup]


# ─────────────────────────────────────────────────────────────────────────
# Meal history + aggregates
# ─────────────────────────────────────────────────────────────────────────


class MealTotals(BaseModel):
    """Snapshot of nutrition totals (kcal, protein, carbs, fat, fiber,
    sodium, sugar) for a logged meal."""

    kcal: float
    protein: float
    carbs: float
    fat: float
    fiber: float
    sodium: float
    sugar: float


class MealEntry(BaseModel):
    """A single logged meal stored in history."""

    id: str
    """ISO 8601 timestamp."""
    date: str
    """Auto-generated meal label."""
    label: str
    items: list[DetectedItem]
    totals: MealTotals
    photo_url: str | None = Field(default=None, alias="photoUrl")
    """Which profile goals were active when this meal was logged."""
    active_goals: HealthGoals = Field(default_factory=lambda: HealthGoals(), alias="activeGoals")
    review_status: str | None = Field(default=None, alias="reviewStatus")

    model_config = ConfigDict(populate_by_name=True)


class UserStats(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    total_meals: int = 0
    total_days_active: int = 0
    avg_daily_kcal: int = 0
    streak_days: int = 0

    @computed_field  # type: ignore[prop-decorator]
    @property
    def totalMeals(self) -> int:
        return self.total_meals

    @computed_field  # type: ignore[prop-decorator]
    @property
    def totalDaysActive(self) -> int:
        return self.total_days_active

    @computed_field  # type: ignore[prop-decorator]
    @property
    def avgDailyKcal(self) -> int:
        return self.avg_daily_kcal

    @computed_field  # type: ignore[prop-decorator]
    @property
    def streakDays(self) -> int:
        return self.streak_days


# Lifted from `getTodaySummary()`'s inline return type in the frontend
# so FastAPI has an explicit response_model.
class TodaySummary(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    meals_logged: int = 0
    total_kcal: float = 0.0
    total_protein: float = 0.0
    total_carbs: float = 0.0
    total_fat: float = 0.0
    daily_kcal_target: float = 2000.0

    @computed_field  # type: ignore[prop-decorator]
    @property
    def mealsLogged(self) -> int:
        return self.meals_logged

    @computed_field  # type: ignore[prop-decorator]
    @property
    def totalKcal(self) -> float:
        return self.total_kcal

    @computed_field  # type: ignore[prop-decorator]
    @property
    def totalProtein(self) -> float:
        return self.total_protein

    @computed_field  # type: ignore[prop-decorator]
    @property
    def totalCarbs(self) -> float:
        return self.total_carbs

    @computed_field  # type: ignore[prop-decorator]
    @property
    def totalFat(self) -> float:
        return self.total_fat

    @computed_field  # type: ignore[prop-decorator]
    @property
    def dailyKcalTarget(self) -> float:
        return self.daily_kcal_target


# ─────────────────────────────────────────────────────────────────────────
# Auth & Admin Telemetry
# ─────────────────────────────────────────────────────────────────────────

Role = Literal["user", "admin"]


class AuthSession(BaseModel):
    email: str
    role: Role
    local_only: bool = Field(default=False, alias="localOnly")
    login_at: str = Field(alias="loginAt")
    name: str | None = None
    avatar_url: str | None = Field(default=None, alias="avatarUrl")
    token: str | None = None
    sub: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class GoogleAuthRequest(BaseModel):
    id_token: str = Field(alias="idToken")

    model_config = ConfigDict(populate_by_name=True)


class GoogleAuthResponse(BaseModel):
    session: AuthSession
    token: str
    profile: UserProfile


class AdminUserSummary(BaseModel):
    email: str
    name: str | None = None
    avatar_url: str | None = Field(default=None, alias="avatarUrl")
    role: Role
    meals_count: int = Field(alias="mealsCount")
    streak_days: int = Field(default=0, alias="streakDays")
    joined_date: str = Field(alias="joinedDate")
    last_active: str = Field(alias="lastActive")

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class DailyMealVolume(BaseModel):
    date: str
    count: int

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class AdminMetrics(BaseModel):
    total_users: int = Field(alias="totalUsers")
    new_users_today: int = Field(default=0, alias="newUsersToday")
    new_users_this_week: int = Field(default=0, alias="newUsersThisWeek")
    active_users7d: int = Field(default=0, alias="activeUsers7d")
    meals_today: int = Field(alias="mealsToday")
    meals_this_week: int = Field(alias="mealsThisWeek")
    total_meals: int = Field(default=0, alias="totalMeals")
    avg_meals_per_user: float = Field(alias="avgMealsPerUser")
    flagged_meals_count: int = Field(default=0, alias="flaggedMealsCount")
    flagged_percentage: float | None = Field(default=None, alias="flaggedPercentage")
    daily_meal_volume: list[DailyMealVolume] = Field(default_factory=list, alias="dailyMealVolume")
    users: list[AdminUserSummary] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class AdminUserDetail(BaseModel):
    user: AdminUserSummary
    profile: UserProfile
    recent_meals: list[MealEntry] = Field(default_factory=list, alias="recentMeals")

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class PopularFoodItem(BaseModel):
    name: str
    count: int
    share_percentage: float = Field(alias="sharePercentage")
    category: str = "other"
    avg_confidence: float = Field(alias="avgConfidence")

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class ReviewQueueItem(BaseModel):
    meal_id: str = Field(alias="mealId")
    user_email: str = Field(alias="userEmail")
    user_name: str | None = Field(default=None, alias="userName")
    timestamp: str
    label: str
    photo_url: str | None = Field(default=None, alias="photoUrl")
    items: list[DetectedItem]
    lowest_confidence: float = Field(alias="lowestConfidence")
    review_status: str = Field(default="pending", alias="reviewStatus")

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


ReviewQueueAction = Literal["approve", "correct", "dismiss"]


class ReviewQueueUpdateRequest(BaseModel):
    action: ReviewQueueAction
    corrected_label: str | None = Field(default=None, alias="correctedLabel")

    model_config = ConfigDict(populate_by_name=True)


# ─────────────────────────────────────────────────────────────────────────
# Targets — daily nutrient ceilings used by the personalize filter.
# Matches `MOCK_TARGETS` in `src/mocks/fixtures.ts`.
# ─────────────────────────────────────────────────────────────────────────


class MacroTargets(BaseModel):
    sodium: float
    sugar: float
    fiber: float
    protein: float
    carbs: float
    fat: float
    kcal: float


# ─────────────────────────────────────────────────────────────────────────
# Multi-Agent AI Coach (Groq / Gemini)
# ─────────────────────────────────────────────────────────────────────────

CoachRole = Literal["user", "assistant", "system"]
CoachAgentType = Literal["scientist", "behavioral", "coach"]


class CoachMessage(BaseModel):
    role: CoachRole
    content: str
    image_ref: str | None = None


class CoachChatRequest(BaseModel):
    messages: list[CoachMessage] = Field(default_factory=list)
    message: str | None = None
    history: list[CoachMessage] | None = None
    agent_type: CoachAgentType = "scientist"
    persona: str | None = None
    user_profile: UserProfile | None = None
    recent_meals: list[MealEntry] | None = None
    grocery_items: list[GroceryItem] | None = None
    lang: str | None = "en"
    include_audio: bool = False


class CoachChatResponse(BaseModel):
    reply: str
    voice_summary: str | None = None
    citations: list[str] = Field(default_factory=list)
    suggested_prompts: list[str] = Field(default_factory=list)
    agent_type: CoachAgentType
    audio_base64: str | None = None
    audio_mime_type: str = "audio/mpeg"
    use_browser_tts: bool = False
    tts_diagnostic: str | None = None


class CoachTTSRequest(BaseModel):
    text: str
    lang: str | None = "en"
    voice_id: str | None = None
    persona: str | None = None


class CoachTTSResponse(BaseModel):
    audio_base64: str | None = None
    audio_mime_type: str = "audio/mpeg"
    use_browser_tts: bool = False
    tts_diagnostic: str | None = None


# ─────────────────────────────────────────────────────────────────────────
# Cut (b) additions — portion estimation support
# ─────────────────────────────────────────────────────────────────────────


class DensityEntry(BaseModel):
    """One row of the per-category density table used by the portion
    estimator. `g_per_ml` is grams per millilitre of typical serving —
    the estimator multiplies the canned seed by this to derive realistic
    portion estimates without a real volume reference."""

    category: FoodCategory
    g_per_ml: float
    """Item-name hint; helps the estimator pick the right row when
    `category` is ambiguous (e.g. a biryani is 'grains', not 'protein')."""
    item_hint: str | None = None


DENSITY_TABLE: list[DensityEntry] = [
    DensityEntry(category="grains", g_per_ml=0.85, item_hint="rice"),
    DensityEntry(category="grains", g_per_ml=0.80, item_hint="biryani"),
    DensityEntry(category="grains", g_per_ml=0.75, item_hint="roti"),
    DensityEntry(category="grains", g_per_ml=0.70, item_hint="noodles"),
    DensityEntry(category="protein", g_per_ml=1.05, item_hint="chicken"),
    DensityEntry(category="protein", g_per_ml=1.00, item_hint="fish"),
    DensityEntry(category="protein", g_per_ml=1.04, item_hint="egg"),
    DensityEntry(category="protein", g_per_ml=1.03, item_hint="paneer"),
    DensityEntry(category="produce", g_per_ml=0.25, item_hint="salad"),
    DensityEntry(category="produce", g_per_ml=0.60, item_hint="fruit"),
    DensityEntry(category="produce", g_per_ml=0.55, item_hint="vegetable"),
    DensityEntry(category="produce", g_per_ml=0.95, item_hint="onion"),
    DensityEntry(category="other", g_per_ml=1.00, item_hint=None),
]


# ─────────────────────────────────────────────────────────────────────────
# Ephemeral Room Chat (relay only, no DB persistence)
# ─────────────────────────────────────────────────────────────────────────

RoomMessageKind = Literal["text", "meal_card", "system"]
RoomDishKind = Literal["meal", "dish"]


class RoomDishItem(BaseModel):
    name: str
    name_bn: str | None = None
    grams: float


class RoomSharedDish(BaseModel):
    title: str
    kind: RoomDishKind
    items: list[RoomDishItem]
    totals: MealTotals
    photo_url: str | None = None


class RoomMessage(BaseModel):
    id: str
    seq: int
    room_code: str
    sender_id: str
    sender_name: str
    kind: RoomMessageKind
    text: str
    dish_card: RoomSharedDish | None = None
    created_at: str


class RoomMember(BaseModel):
    id: str
    name: str


class RoomCreateRequest(BaseModel):
    display_name: str


class RoomJoinRequest(BaseModel):
    display_name: str
    participant_id: str | None = None


class RoomLeaveRequest(BaseModel):
    participant_id: str


class RoomSendMessageRequest(BaseModel):
    participant_id: str
    sender_name: str
    kind: RoomMessageKind
    text: str | None = None
    dish_card: RoomSharedDish | None = None


class RoomJoinResponse(BaseModel):
    room_code: str
    participant_id: str
    display_name: str
    members: list[RoomMember]
    latest_seq: int


class RoomPollResponse(BaseModel):
    room_code: str
    members: list[RoomMember]
    messages: list[RoomMessage]
    latest_seq: int
