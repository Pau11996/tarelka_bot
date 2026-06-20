from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


TRACKED_MICRONUTRIENTS: dict[str, str] = {
    "fiber_g": "Клетчатка, г",
    "sugar_g": "Сахар, г",
    "sodium_mg": "Натрий, мг",
    "potassium_mg": "Калий, мг",
    "calcium_mg": "Кальций, мг",
    "iron_mg": "Железо, мг",
    "magnesium_mg": "Магний, мг",
    "zinc_mg": "Цинк, мг",
    "vitamin_a_mcg": "Витамин A, мкг",
    "vitamin_c_mg": "Витамин C, мг",
    "vitamin_d_mcg": "Витамин D, мкг",
    "vitamin_b12_mcg": "Витамин B12, мкг",
    "omega_3_g": "Омега-3, г",
}


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

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AnalysisResult:
        items = [NutrientItem(**item) for item in data.get("items", [])]
        analysis_type = str(data.get("type", "meal")).lower()
        if analysis_type not in {"meal", "activity"}:
            analysis_type = "meal"
        raw_micronutrients = data.get("micronutrients") or {}
        micronutrients = {
            key: float(raw_micronutrients.get(key, 0) or 0)
            for key in TRACKED_MICRONUTRIENTS
        }
        return cls(
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
        )
