from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, model_validator


TRACKED_MICRONUTRIENTS: dict[str, str] = {
    "fiber_g": "Клетчатка, г",
    "sugar_g": "Сахар, г",
}

MEAL_SLOTS: dict[str, str] = {
    "breakfast": "Завтрак",
    "second_breakfast": "Второй завтрак",
    "lunch": "Обед",
    "lanch": "Ланч",
    "snack": "Перекус",
    "afternoon": "Полдник",
    "dinner": "Ужин",
    "late_dinner": "Поздний ужин",
}

_MEAL_SLOT_ALIASES: dict[str, str] = {
    **{slot: slot for slot in MEAL_SLOTS},
    "завтрак": "breakfast",
    "второй_завтрак": "second_breakfast",
    "обед": "lunch",
    "ланч": "lanch",
    "перекус": "snack",
    "полдник": "afternoon",
    "ужин": "dinner",
    "поздний_ужин": "late_dinner",
}

DEFAULT_WATER_ML = 250.0
ANALYSIS_TYPES = {"meal", "activity", "water", "unknown"}
MANUAL_WEIGHT_ENTRY = "Чтобы записать вес, откройте «Записать вес» и введите число в кг."


def normalize_meal_slot(value: Any) -> str | None:
    if value is None:
        return None
    slot = str(value).strip().lower().replace("-", "_").replace(" ", "_")
    if slot in {"", "null", "none"}:
        return None
    return _MEAL_SLOT_ALIASES.get(slot)


_CAPTION_SLOT_PHRASES: tuple[tuple[str, str], ...] = tuple(
    sorted(
        (
            (alias.replace("_", " "), slot)
            for alias, slot in _MEAL_SLOT_ALIASES.items()
            if alias not in MEAL_SLOTS
        ),
        key=lambda item: len(item[0]),
        reverse=True,
    )
)


def meal_slot_from_text(text: str | None) -> str | None:
    if not text:
        return None
    folded = text.lower().replace("ё", "е")
    for phrase, slot in _CAPTION_SLOT_PHRASES:
        if phrase in folded:
            return slot
    return None


class CoachWeekReview(BaseModel):
    summary: str
    wins: list[str] = Field(default_factory=list)
    improve: list[str] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)


class NutrientItem(BaseModel):
    name: str
    quantity: str | None = None
    calories: float = 0.0
    protein_g: float = 0.0
    fat_g: float = 0.0
    carbs_g: float = 0.0


class AnalysisResult(BaseModel):
    type: str
    title: str = ""
    items: list[NutrientItem] = Field(default_factory=list)
    total_calories: float = 0.0
    protein_g: float = 0.0
    fat_g: float = 0.0
    carbs_g: float = 0.0
    micronutrients: dict[str, float] = Field(default_factory=dict)
    confidence: float = 0.0
    assumptions: list[str] = Field(default_factory=list)
    needs_clarification: bool = False
    clarification_question: str | None = None
    duration_minutes: int | None = None
    portion_assumed: bool = False
    unknown_reason: str | None = None
    meal_slot: str | None = None
    volume_ml: float | None = None
    product_image_url: str | None = None

    @model_validator(mode="after")
    def reject_chat_weight(self) -> AnalysisResult:
        # Reject responses from an older analyzer without turning them into food.
        return apply_typed_result(self) if self.type == "weight" else self

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AnalysisResult:
        analysis_type = str(data.get("type", "meal")).lower()
        if analysis_type == "weight":
            return cls(type="weight")
        items = [NutrientItem(**item) for item in data.get("items", [])]
        if analysis_type not in ANALYSIS_TYPES:
            analysis_type = "meal"
        raw_micronutrients = data.get("micronutrients") or {}
        micronutrients = {
            key: float(raw_micronutrients.get(key, 0) or 0)
            for key in TRACKED_MICRONUTRIENTS
        }
        raw_volume = data.get("volume_ml")
        volume_ml = None
        if raw_volume is not None and raw_volume != "":
            try:
                volume_ml = float(raw_volume)
            except (TypeError, ValueError):
                volume_ml = None
        result = cls(
            type=analysis_type,
            title=data.get("title", ""),
            items=items,
            total_calories=float(data.get("total_calories", 0)),
            protein_g=float(data.get("protein_g", 0)),
            fat_g=float(data.get("fat_g", 0)),
            carbs_g=float(data.get("carbs_g", 0)),
            micronutrients=micronutrients,
            confidence=float(data.get("confidence", 0)),
            assumptions=list(data.get("assumptions") or []),
            needs_clarification=False,
            clarification_question=None,
            duration_minutes=data.get("duration_minutes"),
            portion_assumed=bool(data.get("portion_assumed", False)),
            unknown_reason=data.get("unknown_reason"),
            meal_slot=normalize_meal_slot(data.get("meal_slot")),
            volume_ml=volume_ml,
        )
        return apply_typed_result(result)


def apply_typed_result(result: AnalysisResult) -> AnalysisResult:
    """Keep meal slots on meals and store water as volume only."""
    if result.type == "weight":
        result.type = "unknown"
        result.title = ""
        result.meal_slot = result.volume_ml = result.duration_minutes = None
        result.total_calories = result.protein_g = result.fat_g = result.carbs_g = 0.0
        result.items = []
        result.micronutrients = {key: 0.0 for key in TRACKED_MICRONUTRIENTS}
        result.portion_assumed = False
        result.product_image_url = None
        result.needs_clarification = False
        result.clarification_question = None
        result.unknown_reason = MANUAL_WEIGHT_ENTRY
        return result
    if result.type == "water":
        result.meal_slot = None
        result.total_calories = 0.0
        result.protein_g = 0.0
        result.fat_g = 0.0
        result.carbs_g = 0.0
        result.items = []
        result.micronutrients = {key: 0.0 for key in TRACKED_MICRONUTRIENTS}
        result.duration_minutes = None
        if result.volume_ml is None or result.volume_ml <= 0:
            result.volume_ml = DEFAULT_WATER_ML
            result.portion_assumed = True
        return result
    if result.type == "meal":
        result.volume_ml = None
        return result
    result.meal_slot = None
    result.volume_ml = None
    return result
