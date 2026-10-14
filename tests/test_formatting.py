from src.bot.services.formatting import (
    format_analysis_result,
    format_calorie_bar,
    format_daily_balance,
    format_entry_list,
    format_unknown_result,
    format_water_result,
)
from src.bot.services.nutrition import DailyBalance, calculate_daily_nutrient_targets
from src.db.models import ActivityLevel, DayEntry, EntryType, Goal, Profile, Sex
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


def test_analysis_card_shows_portion_assumed_warning():
    result = AnalysisResult(
        type="meal",
        title="Борщ",
        items=[NutrientItem(name="борщ", quantity="300 г", calories=120)],
        total_calories=120,
        portion_assumed=True,
    )

    text = format_analysis_result(result)

    assert "Вес не указан — взяты стандартные порции" in text
    assert "Нажмите «Изменить», чтобы уточнить" in text


def test_format_unknown_result_card():
    result = AnalysisResult(
        type="unknown",
        total_calories=0,
        unknown_reason="На фото нет еды",
    )

    text = format_unknown_result(result)

    assert "❓ Неизвестный ввод" in text
    assert "Калории: 0 ккал" in text
    assert "На фото нет еды" not in text
    assert "Отправьте фото еды" in text
    assert text == (
        "❓ Неизвестный ввод\n"
        "Калории: 0 ккал\n"
        "Отправьте фото еды, опишите блюдо текстом или расскажите про тренировку."
    )


def test_format_barcode_failure_shows_reason():
    from src.ai_analyzer.products import PRODUCT_NOT_FOUND

    result = AnalysisResult(
        type="unknown",
        total_calories=0,
        unknown_reason=PRODUCT_NOT_FOUND,
    )

    text = format_unknown_result(result)

    assert PRODUCT_NOT_FOUND in text
    assert "Запись в дневник не добавлена." in text
    assert "Неизвестный ввод" not in text


def test_format_estimated_catalog_meal_mentions_missing_label():
    from src.ai_analyzer.products import ESTIMATE_ASSUMPTION

    result = AnalysisResult(
        type="meal",
        title="Творог",
        total_calories=180,
        protein_g=18,
        fat_g=9,
        carbs_g=3,
        portion_assumed=False,
        assumptions=[ESTIMATE_ASSUMPTION],
    )

    text = format_analysis_result(result)

    assert ESTIMATE_ASSUMPTION in text
    assert "Вес не указан" not in text


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

    assert "\n\nВода: 0 мл\n\nПолезные вещества за день:\n" in text
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
    assert f"У: 96.6 / {targets.carbs_g:.1f} г\n\nВода: 0 мл\n\nПолезные вещества за день:\n" in text
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


def test_calorie_bar_matches_example_ratio():
    assert format_calorie_bar(1640, 2000) == "🟩🟩🟩🟩🟩🟩🟩🟩⬜⬜  1640 / 2000 ккал"


def test_calorie_bar_includes_activity_in_budget():
    assert format_calorie_bar(0, 1804, activity_bonus=250) == "⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜  0 / 2054 ккал"
    assert format_calorie_bar(1640, 2000, activity_bonus=400) == "🟩🟩🟩🟩🟩🟩🟩⬜⬜⬜  1640 / 2400 ккал"


def test_calorie_bar_overflow_keeps_full_scale():
    text = format_calorie_bar(2180, 2000)
    assert text.startswith("🟥🟥🟥🟥🟥🟥🟥🟥🟥🟥  2180 / 2000 ккал")
    assert "+180 ккал сверх нормы" in text
    assert text.count("🟥") == 10
    assert "⬜" not in text.split("\n", 1)[0]


def test_calorie_bar_overflow_uses_activity_budget():
    text = format_calorie_bar(2300, 2000, activity_bonus=200)
    assert text.startswith("🟥🟥🟥🟥🟥🟥🟥🟥🟥🟥  2300 / 2200 ккал")
    assert "+100 ккал сверх нормы" in text


def test_daily_balance_shows_bar_and_streak():
    balance = DailyBalance(
        target=2000,
        consumed=1640,
        activity_bonus=0,
        remaining=360,
        protein_g=10,
        fat_g=5,
        carbs_g=40,
        micronutrients={},
    )

    text = format_daily_balance(balance, include_micronutrients=False, streak=4)

    assert "🟩🟩🟩🟩🟩🟩🟩🟩⬜⬜  1640 / 2000 ккал" in text
    assert "Серия: 4 дня" in text


def test_daily_balance_bar_adds_activity_to_budget():
    balance = DailyBalance(
        target=1804,
        consumed=0,
        activity_bonus=250,
        remaining=2054,
        protein_g=0,
        fat_g=0,
        carbs_g=0,
        micronutrients={},
    )

    text = format_daily_balance(balance, include_micronutrients=False, streak=1)

    assert "⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜  0 / 2054 ккал" in text
    assert "0 / 1804" not in text


def test_analysis_card_includes_bar_and_streak_from_balance():
    balance = DailyBalance(
        target=2000,
        consumed=300,
        activity_bonus=0,
        remaining=1700,
        protein_g=10,
        fat_g=5,
        carbs_g=40,
        micronutrients={},
        streak=1,
    )
    result = AnalysisResult(type="meal", title="Йогурт", total_calories=120)

    text = format_analysis_result(result, balance)

    assert "⬜" in text
    assert "300 / 2000 ккал" in text
    assert "Серия: 1 день" in text


def test_daily_balance_shows_water_total():
    balance = DailyBalance(
        target=2000,
        consumed=300,
        activity_bonus=0,
        remaining=1700,
        protein_g=0,
        fat_g=0,
        carbs_g=0,
        micronutrients={},
        water_ml=750,
    )

    text = format_daily_balance(balance, include_micronutrients=False)

    assert "Активность: +0 ккал\n\n<b>ОСТАЛОСЬ: 1700 ккал</b>" in text
    assert "БЖУ за день:\nБ: 0.0 г | Ж: 0.0 г | У: 0.0 г\n\nВода: 750 мл" in text


def test_entry_list_shows_meal_slot_and_water():
    entries = [
        DayEntry(
            id=1,
            user_id=1,
            entry_type=EntryType.MEAL,
            title="овсянка",
            calories=320,
            meal_slot="breakfast",
        ),
        DayEntry(
            id=2,
            user_id=1,
            entry_type=EntryType.MEAL,
            title="яблоко",
            calories=80,
        ),
        DayEntry(
            id=3,
            user_id=1,
            entry_type=EntryType.WATER,
            title="Стакан воды",
            calories=0,
            volume_ml=250,
        ),
    ]

    text = format_entry_list(entries)

    assert "🍽 Завтрак · овсянка: -320 ккал" in text
    assert "🍽 яблоко: -80 ккал" in text
    assert "Завтрак · яблоко" not in text
    assert "💧 Стакан воды: 250 мл" in text


def test_analysis_card_prefixes_named_meal():
    result = AnalysisResult(type="meal", title="овсянка", total_calories=320, meal_slot="breakfast")

    text = format_analysis_result(result)

    assert "🍽 Завтрак · овсянка" in text


def test_water_card_shows_volume():
    result = AnalysisResult(
        type="water",
        title="Стакан воды",
        volume_ml=250,
        portion_assumed=True,
    )

    text = format_water_result(result)

    assert "💧 Стакан воды" in text
    assert "Объём: 250 мл" in text
    assert "взято 250 мл" in text

