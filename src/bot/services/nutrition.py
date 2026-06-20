from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from src.db.models import ActivityLevel, DayEntry, EntryType, Goal, Profile, Sex
from src.shared.schemas import TRACKED_MICRONUTRIENTS


ACTIVITY_MULTIPLIERS: dict[ActivityLevel, float] = {
    ActivityLevel.SEDENTARY: 1.2,
    ActivityLevel.LIGHT: 1.375,
    ActivityLevel.MODERATE: 1.55,
    ActivityLevel.ACTIVE: 1.725,
    ActivityLevel.VERY_ACTIVE: 1.9,
}

GOAL_ADJUSTMENTS: dict[Goal, int] = {
    Goal.LOSE: -500,
    Goal.MAINTAIN: 0,
    Goal.GAIN: 300,
}


def calculate_bmr(*, weight_kg: float, height_cm: float, age: int, sex: Sex) -> float:
    if sex == Sex.MALE:
        return 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
    return 10 * weight_kg + 6.25 * height_cm - 5 * age - 161


def calculate_daily_target(
    *,
    weight_kg: float,
    height_cm: float,
    age: int,
    sex: Sex,
    goal: Goal,
    activity_level: ActivityLevel,
) -> float:
    bmr = calculate_bmr(weight_kg=weight_kg, height_cm=height_cm, age=age, sex=sex)
    tdee = bmr * ACTIVITY_MULTIPLIERS[activity_level]
    return max(1200.0, round(tdee + GOAL_ADJUSTMENTS[goal]))


def build_profile_target(profile: Profile) -> float:
    return calculate_daily_target(
        weight_kg=profile.weight_kg,
        height_cm=profile.height_cm,
        age=profile.age,
        sex=profile.sex,
        goal=profile.goal,
        activity_level=profile.activity_level,
    )


@dataclass
class DailyNutrientTargets:
    protein_g: float
    fat_g: float
    carbs_g: float
    micronutrients: dict[str, float]


PROTEIN_G_PER_KG: dict[Goal, float] = {
    Goal.LOSE: 1.8,
    Goal.MAINTAIN: 1.6,
    Goal.GAIN: 2.0,
}

FAT_CALORIE_SHARE: dict[Goal, float] = {
    Goal.LOSE: 0.25,
    Goal.MAINTAIN: 0.27,
    Goal.GAIN: 0.25,
}

MICRONUTRIENT_TARGETS: dict[Sex, dict[str, float]] = {
    Sex.MALE: {
        "fiber_g": 30.0,
        "sugar_g": 50.0,
        "sodium_mg": 2000.0,
        "potassium_mg": 3500.0,
        "calcium_mg": 1000.0,
        "iron_mg": 8.0,
        "magnesium_mg": 400.0,
        "zinc_mg": 11.0,
        "vitamin_a_mcg": 900.0,
        "vitamin_c_mg": 90.0,
        "vitamin_d_mcg": 15.0,
        "vitamin_b12_mcg": 2.4,
        "omega_3_g": 1.6,
    },
    Sex.FEMALE: {
        "fiber_g": 25.0,
        "sugar_g": 50.0,
        "sodium_mg": 2000.0,
        "potassium_mg": 2600.0,
        "calcium_mg": 1000.0,
        "iron_mg": 18.0,
        "magnesium_mg": 310.0,
        "zinc_mg": 8.0,
        "vitamin_a_mcg": 700.0,
        "vitamin_c_mg": 75.0,
        "vitamin_d_mcg": 15.0,
        "vitamin_b12_mcg": 2.4,
        "omega_3_g": 1.1,
    },
}


@dataclass
class DailyBalance:
    target: float
    consumed: float
    activity_bonus: float
    remaining: float
    protein_g: float
    fat_g: float
    carbs_g: float
    micronutrients: dict[str, float]


def calculate_daily_nutrient_targets(profile: Profile) -> DailyNutrientTargets:
    calories = profile.daily_calorie_target
    protein_g = round(profile.weight_kg * PROTEIN_G_PER_KG[profile.goal], 1)
    fat_g = round((calories * FAT_CALORIE_SHARE[profile.goal]) / 9, 1)
    protein_calories = protein_g * 4
    fat_calories = fat_g * 9
    carbs_g = round(max(0.0, (calories - protein_calories - fat_calories) / 4), 1)

    base_targets = MICRONUTRIENT_TARGETS[profile.sex]
    micronutrients = {
        key: base_targets[key]
        for key in TRACKED_MICRONUTRIENTS
    }
    micronutrients["fiber_g"] = round(calories / 1000 * 14, 1)
    micronutrients["sugar_g"] = round(calories * 0.10 / 4, 1)

    return DailyNutrientTargets(
        protein_g=protein_g,
        fat_g=fat_g,
        carbs_g=carbs_g,
        micronutrients=micronutrients,
    )


def calculate_daily_balance(target: float, entries: list[DayEntry]) -> DailyBalance:
    consumed = 0.0
    activity_bonus = 0.0
    protein_g = 0.0
    fat_g = 0.0
    carbs_g = 0.0
    micronutrients = {key: 0.0 for key in TRACKED_MICRONUTRIENTS}

    for entry in entries:
        if entry.entry_type == EntryType.MEAL:
            consumed += entry.calories
            protein_g += entry.protein_g
            fat_g += entry.fat_g
            carbs_g += entry.carbs_g
            for key in TRACKED_MICRONUTRIENTS:
                if entry.micronutrients:
                    micronutrients[key] += float(entry.micronutrients.get(key, 0) or 0)
        elif entry.entry_type == EntryType.ACTIVITY:
            activity_bonus += entry.calories

    remaining = target - consumed + activity_bonus
    return DailyBalance(
        target=target,
        consumed=consumed,
        activity_bonus=activity_bonus,
        remaining=remaining,
        protein_g=protein_g,
        fat_g=fat_g,
        carbs_g=carbs_g,
        micronutrients=micronutrients,
    )


def local_today(timezone_name: str) -> date:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    return datetime.now(ZoneInfo(timezone_name)).date()
