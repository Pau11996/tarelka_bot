from __future__ import annotations

import json
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
from typing import Any

from src.shared.schemas import AnalysisResult, NutrientItem, TRACKED_MICRONUTRIENTS

FOODS_PATH = Path(__file__).resolve().parent / "data" / "foods.json"
_FUZZY_THRESHOLD = 0.82
_NORMALIZE_RE = re.compile(r"[^a-zа-я0-9%.,\s]+", re.IGNORECASE)


@dataclass(frozen=True)
class FoodEntry:
    name: str
    aliases: tuple[str, ...]
    calories: float
    protein_g: float
    fat_g: float
    carbs_g: float
    fiber_g: float
    sugar_g: float


def normalize_name(value: str) -> str:
    text = (value or "").strip().lower().replace("ё", "е")
    text = _NORMALIZE_RE.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


@lru_cache(maxsize=1)
def load_foods() -> tuple[FoodEntry, ...]:
    raw = json.loads(FOODS_PATH.read_text(encoding="utf-8"))
    foods: list[FoodEntry] = []
    for item in raw:
        foods.append(
            FoodEntry(
                name=str(item["name"]),
                aliases=tuple(str(alias) for alias in item.get("aliases") or []),
                calories=float(item.get("calories", 0) or 0),
                protein_g=float(item.get("protein_g", 0) or 0),
                fat_g=float(item.get("fat_g", 0) or 0),
                carbs_g=float(item.get("carbs_g", 0) or 0),
                fiber_g=float(item.get("fiber_g", 0) or 0),
                sugar_g=float(item.get("sugar_g", 0) or 0),
            )
        )
    return tuple(foods)


def _candidate_keys(entry: FoodEntry) -> list[str]:
    return [normalize_name(entry.name), *[normalize_name(alias) for alias in entry.aliases]]


def find_food(name: str) -> FoodEntry | None:
    query = normalize_name(name)
    if not query:
        return None

    foods = load_foods()
    for entry in foods:
        if query in _candidate_keys(entry):
            return entry

    best_entry: FoodEntry | None = None
    best_score = 0.0
    for entry in foods:
        for key in _candidate_keys(entry):
            if not key:
                continue
            score = SequenceMatcher(None, query, key).ratio()
            if query in key or key in query:
                score = max(score, 0.9)
            if score > best_score:
                best_score = score
                best_entry = entry

    if best_entry is not None and best_score >= _FUZZY_THRESHOLD:
        return best_entry
    return None


def _scale(value: float, weight_g: float) -> float:
    return round(value * weight_g / 100.0, 2)


def calculate_from_table(
    identification: dict[str, Any],
) -> AnalysisResult | None:
    components = identification.get("components") or []
    if not components:
        return None

    items: list[NutrientItem] = []
    total_calories = 0.0
    total_protein = 0.0
    total_fat = 0.0
    total_carbs = 0.0
    total_fiber = 0.0
    total_sugar = 0.0

    for component in components:
        name = str(component.get("name") or "").strip()
        weight_g = float(component.get("estimated_weight_g") or 0)
        if weight_g <= 0:
            return None
        food = find_food(name)
        if food is None:
            return None

        calories = _scale(food.calories, weight_g)
        protein_g = _scale(food.protein_g, weight_g)
        fat_g = _scale(food.fat_g, weight_g)
        carbs_g = _scale(food.carbs_g, weight_g)
        fiber_g = _scale(food.fiber_g, weight_g)
        sugar_g = _scale(food.sugar_g, weight_g)

        items.append(
            NutrientItem(
                name=name or food.name,
                quantity=f"{weight_g:g} г",
                calories=calories,
                protein_g=protein_g,
                fat_g=fat_g,
                carbs_g=carbs_g,
            )
        )
        total_calories += calories
        total_protein += protein_g
        total_fat += fat_g
        total_carbs += carbs_g
        total_fiber += fiber_g
        total_sugar += sugar_g

    micronutrients = {
        key: 0.0 for key in TRACKED_MICRONUTRIENTS
    }
    micronutrients["fiber_g"] = round(total_fiber, 2)
    micronutrients["sugar_g"] = round(total_sugar, 2)

    assumptions = list(identification.get("assumptions") or [])
    assumptions.append("КБЖУ рассчитаны по локальной таблице продуктов")

    return AnalysisResult(
        type="meal",
        title=str(identification.get("title") or "Прием пищи"),
        items=items,
        total_calories=round(total_calories, 2),
        protein_g=round(total_protein, 2),
        fat_g=round(total_fat, 2),
        carbs_g=round(total_carbs, 2),
        micronutrients=micronutrients,
        confidence=float(identification.get("confidence") or 0.8),
        assumptions=assumptions,
        needs_clarification=False,
        clarification_question=None,
        duration_minutes=None,
    )
