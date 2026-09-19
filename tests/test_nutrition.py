from datetime import date

import pytest

from src.bot.services.nutrition import (
    calculate_bmr,
    calculate_daily_balance,
    calculate_daily_nutrient_targets,
    calculate_daily_target,
    calculate_logging_streak,
)
from src.db.models import ActivityLevel, DayEntry, EntryType, Goal, Profile, Sex


def test_calculate_bmr_male():
    bmr = calculate_bmr(weight_kg=80, height_cm=180, age=30, sex=Sex.MALE)
    assert 1750 < bmr < 1850


def test_calculate_bmr_female():
    bmr = calculate_bmr(weight_kg=60, height_cm=165, age=25, sex=Sex.FEMALE)
    assert 1300 < bmr < 1400


def test_calculate_daily_target_lose_goal():
    target = calculate_daily_target(
        weight_kg=80,
        height_cm=180,
        age=30,
        sex=Sex.MALE,
        goal=Goal.LOSE,
        activity_level=ActivityLevel.MODERATE,
    )
    maintain = calculate_daily_target(
        weight_kg=80,
        height_cm=180,
        age=30,
        sex=Sex.MALE,
        goal=Goal.MAINTAIN,
        activity_level=ActivityLevel.MODERATE,
    )
    assert target < maintain
    assert target >= 1200


def test_daily_balance_with_meals_and_activity():
    entries = [
        DayEntry(
            id=1,
            user_id=1,
            entry_date=date.today(),
            entry_type=EntryType.MEAL,
            title="Breakfast",
            calories=500,
            protein_g=30,
            fat_g=15,
            carbs_g=50,
            micronutrients={"fiber_g": 5, "sugar_g": 10},
        ),
        DayEntry(
            id=2,
            user_id=1,
            entry_date=date.today(),
            entry_type=EntryType.MEAL,
            title="Lunch",
            calories=700,
            protein_g=40,
            fat_g=20,
            carbs_g=60,
            micronutrients={"fiber_g": 7, "sugar_g": 15},
        ),
        DayEntry(
            id=3,
            user_id=1,
            entry_date=date.today(),
            entry_type=EntryType.ACTIVITY,
            title="Run",
            calories=300,
        ),
    ]

    balance = calculate_daily_balance(2500, entries)
    assert balance.consumed == 1200
    assert balance.activity_bonus == 300
    assert balance.remaining == 1600
    assert balance.protein_g == 70
    assert balance.fat_g == 35
    assert balance.carbs_g == 110
    assert balance.micronutrients["fiber_g"] == 12
    assert balance.micronutrients["sugar_g"] == 25
    assert "sodium_mg" not in balance.micronutrients


def test_calculate_daily_nutrient_targets():
    profile = Profile(
        id=1,
        user_id=1,
        weight_kg=80,
        height_cm=180,
        age=30,
        sex=Sex.MALE,
        goal=Goal.MAINTAIN,
        activity_level=ActivityLevel.MODERATE,
        daily_calorie_target=2500,
    )
    targets = calculate_daily_nutrient_targets(profile)

    assert targets.protein_g == 128.0
    assert targets.fat_g == 75.0
    assert targets.carbs_g == 328.2
    assert targets.micronutrients["fiber_g"] == 35.0
    assert targets.micronutrients["sugar_g"] == 62.5
    assert "iron_mg" not in targets.micronutrients


def test_logging_streak_counts_consecutive_days_including_at_risk_today():
    today = date(2026, 9, 17)
    dates = {date(2026, 9, 14), date(2026, 9, 15), date(2026, 9, 16)}
    assert calculate_logging_streak(dates, today) == 3


def test_logging_streak_includes_today():
    today = date(2026, 9, 17)
    dates = {date(2026, 9, 15), date(2026, 9, 16), date(2026, 9, 17)}
    assert calculate_logging_streak(dates, today) == 3


def test_logging_streak_is_zero_when_last_entry_is_two_days_ago():
    today = date(2026, 9, 17)
    dates = {date(2026, 9, 14), date(2026, 9, 15)}
    assert calculate_logging_streak(dates, today) == 0


def test_logging_streak_is_one_when_only_yesterday():
    today = date(2026, 9, 17)
    assert calculate_logging_streak({date(2026, 9, 16)}, today) == 1

