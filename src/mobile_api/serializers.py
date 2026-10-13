from __future__ import annotations

from datetime import date, datetime

from src.bot.services.nutrition import DailyBalance, DailyNutrientTargets
from src.db.models import DayEntry, FavoriteMeal, Profile, WeightHistory


def _iso(value: datetime | date | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def entry_out(entry: DayEntry) -> dict:
    return {
        "id": entry.id,
        "entry_date": _iso(entry.entry_date),
        "entry_type": entry.entry_type.value,
        "title": entry.title,
        "calories": entry.calories,
        "protein_g": entry.protein_g,
        "fat_g": entry.fat_g,
        "carbs_g": entry.carbs_g,
        "micronutrients": entry.micronutrients,
        "items": entry.items,
        "duration_minutes": entry.duration_minutes,
        "meal_slot": entry.meal_slot,
        "volume_ml": entry.volume_ml,
        "created_at": _iso(entry.created_at),
    }


def balance_out(balance: DailyBalance) -> dict:
    return {
        "target": balance.target,
        "consumed": balance.consumed,
        "activity_bonus": balance.activity_bonus,
        "remaining": balance.remaining,
        "protein_g": balance.protein_g,
        "fat_g": balance.fat_g,
        "carbs_g": balance.carbs_g,
        "micronutrients": balance.micronutrients,
        "water_ml": balance.water_ml,
        "streak": balance.streak,
    }


def nutrient_targets_out(targets: DailyNutrientTargets) -> dict:
    return {
        "protein_g": targets.protein_g,
        "fat_g": targets.fat_g,
        "carbs_g": targets.carbs_g,
        "micronutrients": targets.micronutrients,
    }


def profile_out(profile: Profile) -> dict:
    return {
        "weight_kg": profile.weight_kg,
        "height_cm": profile.height_cm,
        "age": profile.age,
        "sex": profile.sex.value if profile.sex is not None else None,
        "goal": profile.goal.value if profile.goal is not None else None,
        "activity_level": profile.activity_level.value if profile.activity_level is not None else None,
        "daily_calorie_target": profile.daily_calorie_target,
        "is_complete": profile.is_complete(),
    }


def favorite_out(favorite: FavoriteMeal) -> dict:
    return {
        "id": favorite.id,
        "entry_type": favorite.entry_type.value,
        "title": favorite.title,
        "calories": favorite.calories,
        "protein_g": favorite.protein_g,
        "fat_g": favorite.fat_g,
        "carbs_g": favorite.carbs_g,
        "micronutrients": favorite.micronutrients,
        "items": favorite.items,
        "duration_minutes": favorite.duration_minutes,
        "volume_ml": favorite.volume_ml,
        "source_entry_id": favorite.source_entry_id,
        "created_at": _iso(favorite.created_at),
    }


def weight_out(record: WeightHistory) -> dict:
    return {
        "recorded_at": _iso(record.recorded_at),
        "weight_kg": record.weight_kg,
    }
