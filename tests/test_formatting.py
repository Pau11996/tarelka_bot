from src.bot.services.formatting import format_analysis_result, format_daily_balance
from src.bot.services.nutrition import DailyBalance, calculate_daily_nutrient_targets
from src.db.models import ActivityLevel, Goal, Profile, Sex
from src.shared.schemas import AnalysisResult, NutrientItem


def test_analysis_card_does_not_include_daily_micronutrients():
    balance = DailyBalance(
        target=2000,
        consumed=300,
        activity_bonus=0,
        remaining=1700,
        protein_g=10,
        fat_g=5,
        carbs_g=40,
        micronutrients={"fiber_g": 3, "sugar_g": 8},
    )
    result = AnalysisResult(
        type="meal",
        title="Йогурт",
        items=[
            NutrientItem(
                name="йогурт",
                quantity="150 г",
                calories=120,
                protein_g=8,
                fat_g=3,
                carbs_g=14,
            )
        ],
        total_calories=120,
        protein_g=8,
        fat_g=3,
        carbs_g=14,
        micronutrients={"fiber_g": 1, "sugar_g": 12},
    )

    text = format_analysis_result(result, balance)

    assert "Полезные вещества за день" not in text
    assert "Клетчатка: 1 г | Сахар: 12 г" in text
    assert "йогурт (150 г): 120 ккал, Б 8.0 г | Ж 3.0 г | У 14.0 г" in text
    assert "<b>ОСТАЛОСЬ: 1700 ккал</b>" in text


def test_daily_balance_can_include_micronutrients():
    balance = DailyBalance(
        target=2000,
        consumed=300,
        activity_bonus=0,
        remaining=1700,
        protein_g=10,
        fat_g=5,
        carbs_g=40,
        micronutrients={"fiber_g": 3, "sugar_g": 8},
    )

    text = format_daily_balance(balance)

    assert "Полезные вещества за день" in text
    assert "<b>ОСТАЛОСЬ: 1700 ккал</b>" in text
    assert "Клетчатка, г: 3" in text
    assert "Сахар, г: 8" in text
    assert "Натрий" not in text


def test_daily_balance_with_profile_shows_targets_through_slash():
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
    balance = DailyBalance(
        target=2500,
        consumed=544,
        activity_bonus=0,
        remaining=1956,
        protein_g=29.8,
        fat_g=3.8,
        carbs_g=96.6,
        micronutrients={"fiber_g": 3, "sugar_g": 8},
    )

    text = format_daily_balance(balance, profile=profile)
    targets = calculate_daily_nutrient_targets(profile)

    assert f"Б: 29.8 / {targets.protein_g:.1f} г" in text
    assert f"Ж: 3.8 / {targets.fat_g:.1f} г" in text
    assert f"У: 96.6 / {targets.carbs_g:.1f} г" in text
    assert "Клетчатка, г: 3 / 35" in text
    assert f"Сахар, г: 8 / {targets.micronutrients['sugar_g']:g}" in text
    assert "Натрий" not in text
    assert "Железо" not in text


def test_analysis_card_escapes_html_values():
    balance = DailyBalance(
        target=2000,
        consumed=100,
        activity_bonus=0,
        remaining=1900,
        protein_g=1,
        fat_g=1,
        carbs_g=1,
        micronutrients={},
    )
    result = AnalysisResult(
        type="meal",
        title="Рыба <test>",
        items=[NutrientItem(name="соус & сыр", quantity="<50 г>", calories=100)],
        total_calories=100,
    )

    text = format_analysis_result(result, balance)

    assert "Рыба &lt;test&gt;" in text
    assert "соус &amp; сыр (&lt;50 г&gt;)" in text
