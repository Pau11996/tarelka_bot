"""Shared cases keep the mobile onboarding preview aligned with the server."""
import json
from pathlib import Path

from src.bot.services.nutrition import calculate_daily_target
from src.db.models import ActivityLevel, Goal, Sex


def test_mobile_preview_cases_match_server_calculation():
    cases = json.loads((Path(__file__).parent / "fixtures/profile_targets.json").read_text())
    for case in cases:
        profile = case["profile"]
        assert calculate_daily_target(
            **{key: profile[key] for key in ("weight_kg", "height_cm", "age")},
            sex=Sex(profile["sex"]),
            goal=Goal(profile["goal"]),
            activity_level=ActivityLevel(profile["activity_level"]),
        ) == case["target"], profile
