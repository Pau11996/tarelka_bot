from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from aiogram.exceptions import TelegramBadRequest
from aiogram.methods import SendMessage

from src.bot.services.charts import DailyCaloriesPoint, WeightPoint
from src.bot.services.nutrition import DailyBalance, calculate_daily_nutrient_targets
from src.bot.services.rich_cards import (
    build_month_advanced,
    format_day_rich,
    format_month_rich,
    format_weight_rich,
)
from src.db.models import ActivityLevel, DayEntry, EntryType, Goal, Profile, Sex


def _profile() -> Profile:
    return Profile(
        id=1,
        user_id=1,
        weight_kg=80,
        height_cm=180,
        age=30,
        sex=Sex.MALE,
        goal=Goal.MAINTAIN,
        activity_level=ActivityLevel.MODERATE,
        daily_calorie_target=2000,
    )


def _meal(day: date, calories: float, *, slot: str | None = None, fiber: float = 0, sugar: float = 0) -> DayEntry:
    return DayEntry(
        id=1,
        user_id=1,
        entry_date=day,
        entry_type=EntryType.MEAL,
        title="овсянка <test>",
        calories=calories,
        protein_g=20,
        fat_g=10,
        carbs_g=30,
        meal_slot=slot,
        micronutrients={"fiber_g": fiber, "sugar_g": sugar},
    )


def _balance(**overrides) -> DailyBalance:
    data = dict(
        target=2000,
        consumed=300,
        activity_bonus=0,
        remaining=1700,
        protein_g=10,
        fat_g=5,
        carbs_g=40,
        micronutrients={"fiber_g": 0, "sugar_g": 0},
        water_ml=250,
    )
    data.update(overrides)
    return DailyBalance(**data)


def test_month_card_keeps_current_numbers_without_extra_block():
    points = [
        DailyCaloriesPoint(day=date(2026, 6, 1), calories=1000),
        DailyCaloriesPoint(day=date(2026, 6, 2), calories=0),
        DailyCaloriesPoint(day=date(2026, 6, 3), calories=500),
    ]

    html = format_month_rich(points, 2000)

    assert "<h2>Калории за последние 30 дней</h2>" in html
    assert "1500 ккал" in html
    assert "750 ккал" in html
    assert "2000 ккал" in html
    assert "1000 ккал (01.06.2026)" in html
    assert "Подробнее" not in html
    assert "К целям" not in html


def test_month_card_adds_targets_only_for_subscribers():
    day = date(2026, 6, 1)
    entries = [
        _meal(day, 2500, slot="breakfast", fiber=4, sugar=6),
        _meal(day, 0, slot="lunch"),
        _meal(day + timedelta(days=1), 500, slot="lanch"),
        DayEntry(
            id=2,
            user_id=1,
            entry_date=day,
            entry_type=EntryType.WATER,
            title="Вода",
            calories=0,
            volume_ml=500,
        ),
        DayEntry(
            id=3,
            user_id=1,
            entry_date=day,
            entry_type=EntryType.ACTIVITY,
            title="Бег",
            calories=180,
            duration_minutes=30,
        ),
    ]
    profile = _profile()
    advanced = build_month_advanced(entries, profile=profile, target=2000, days_in_period=30)
    targets = calculate_daily_nutrient_targets(profile)
    points = [
        DailyCaloriesPoint(day=day, calories=2500),
        DailyCaloriesPoint(day=day + timedelta(days=1), calories=500),
    ]

    html = format_month_rich(points, 2000, advanced=advanced)

    assert "Подробнее" in html
    assert "2 из 30, выше нормы: 1" in html
    assert f"{targets.protein_g:.1f} г" in html
    assert "Завтрак" in html and "1 из 30 дней" in html
    assert "Обед" in html and "2 из 30 дней" in html
    assert "500 мл" in html
    assert "тренировок 1, 30 мин, 180 ккал" in html
    assert "Клетчатка в день с едой" in html
    assert f"{targets.micronutrients['fiber_g']:g} г" in html


def test_weight_card_shows_delta_for_everyone():
    points = [
        WeightPoint(recorded_at=datetime(2026, 5, 1, tzinfo=timezone.utc), weight_kg=80),
        WeightPoint(recorded_at=datetime(2026, 6, 1, tzinfo=timezone.utc), weight_kg=78.5),
    ]

    html = format_weight_rich(points, 78.5)

    assert "<h2>Динамика веса</h2>" in html
    assert "78.5 кг" in html
    assert "-1.5 кг (80 → 78.5)" in html
    assert "01.05.2026 — 01.06.2026" in html
    assert "Подробнее" not in html


def test_day_card_hides_targets_without_subscription():
    entries = [_meal(date(2026, 6, 18), 300, slot="breakfast")]
    balance = _balance(micronutrients={"fiber_g": 3, "sugar_g": 8})

    html = format_day_rich(date(2026, 6, 18), balance, entries, subscriber=False, profile=_profile())

    assert "<h2>Статистика за 18.06.2026</h2>" in html
    assert "ОСТАЛОСЬ: 1700 ккал" in html
    assert "овсянка &lt;test&gt;" in html
    assert "Полезные вещества" in html
    assert "К целям" not in html


def test_day_card_shows_targets_for_subscriber():
    entries = [_meal(date(2026, 6, 18), 300, fiber=3, sugar=8)]
    balance = _balance(micronutrients={"fiber_g": 3, "sugar_g": 8})
    profile = _profile()
    targets = calculate_daily_nutrient_targets(profile)

    html = format_day_rich(date(2026, 6, 18), balance, entries, subscriber=True, profile=profile)

    assert "К целям" in html
    assert f"{targets.protein_g:.1f} г" in html
    assert f"{targets.micronutrients['sugar_g']:g} г" in html


@pytest.mark.asyncio
async def test_answer_rich_falls_back_to_plain_text() -> None:
    from src.bot.services.message_cleanup import MessageCleanupService
    from src.bot.services.messaging import answer_rich

    sent = AsyncMock()
    sent.chat.id = 55
    sent.message_id = 88
    message = AsyncMock()
    message.chat.id = 55
    message.message_id = 10
    message.bot = AsyncMock()
    message.bot.send_rich_message = AsyncMock(
        side_effect=TelegramBadRequest(method=SendMessage(chat_id=1, text="x"), message="unsupported")
    )
    message.answer = AsyncMock(return_value=sent)
    cleanup = MessageCleanupService(ttl_seconds=60)

    result = await answer_rich(
        message,
        "<h2>Месяц</h2>",
        fallback_text="Месяц",
        cleanup=cleanup,
        track_user=False,
        reply_markup=MagicMock(),
    )

    assert result is sent
    assert message.answer.await_args.args[0] == "Месяц"
    assert len(cleanup._tasks) == 1
