from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo

import pytest
from aiogram.exceptions import TelegramForbiddenError
from aiogram.methods import SendMessage

from src.ai_analyzer.parsing import parse_coach_review
from src.ai_analyzer.prompts import build_coach_week_prompt
from src.bot.handlers.subscription import format_subscription_status
from src.bot.services.coach import (
    MIN_LOGGED_DAYS,
    build_week_digest,
    decide_week_action,
    digest_facts,
    format_activity_report,
    format_week_message,
    process_sunday_coach_pushes,
    should_send_sunday_review,
    week_review_allowed,
)
from src.db.models import CoachReview, DayEntry, EntryType, Goal, Profile, User
from src.shared.schemas import CoachWeekReview

MOSCOW = ZoneInfo("Europe/Moscow")
SUNDAY = date(2026, 10, 11)


def _local(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=MOSCOW)


def _profile() -> Profile:
    return Profile(
        user_id=1,
        daily_calorie_target=2000,
        goal=Goal.LOSE,
        weight_kg=70,
    )


def _meal(
    day: date,
    hour: int,
    *,
    title: str = "еда",
    calories: float = 500,
    minute: int = 0,
) -> DayEntry:
    return DayEntry(
        user_id=1,
        entry_date=day,
        entry_type=EntryType.MEAL,
        title=title,
        calories=calories,
        protein_g=30,
        fat_g=10,
        carbs_g=40,
        created_at=_local(day, hour, minute),
    )


def _activity(day: date, calories: float = 200) -> DayEntry:
    return DayEntry(
        user_id=1,
        entry_date=day,
        entry_type=EntryType.ACTIVITY,
        title="пробежка",
        calories=calories,
        created_at=_local(day, 8),
    )


def _digest(entries: list[DayEntry], local_now: datetime):
    return build_week_digest(
        entries=entries,
        profile=_profile(),
        local_now=local_now,
        timezone_name="Europe/Moscow",
    )


def test_sunday_date_used_by_push_window() -> None:
    assert SUNDAY.weekday() == 6


def test_activity_report_lists_workouts_and_empty_week() -> None:
    start = date(2026, 10, 6)
    end = date(2026, 10, 12)
    run = _activity(date(2026, 10, 7), calories=250)
    run.title = "пробежка"
    run.duration_minutes = 30
    gym = _activity(date(2026, 10, 9), calories=400)
    gym.title = "зал"
    gym.duration_minutes = 45
    meal = _meal(date(2026, 10, 7), 12, title="гречка")

    text = format_activity_report([meal, gym, run], start=start, end=end)
    assert "6–12 октября" in text
    assert "2 записи" in text
    assert "за 2 дня" in text
    assert "650 ккал" in text
    assert "75 мин" in text
    assert "пробежка, 30 мин, 250 ккал" in text
    assert "зал, 45 мин, 400 ккал" in text
    assert "гречка" not in text

    empty = format_activity_report([meal], start=start, end=end)
    assert "тренировок пока нет" in empty


def test_empty_day_single_meal_and_long_gap() -> None:
    end = date(2026, 10, 7)
    entries = [
        _meal(date(2026, 10, 2), 12, title="омлет", calories=400),
        _meal(date(2026, 10, 3), 9, title="каша", calories=300),
        _meal(date(2026, 10, 3), 18, title="курица", calories=700),
        _meal(date(2026, 10, 4), 9, calories=500),
        _meal(date(2026, 10, 4), 15, calories=500),
        _activity(date(2026, 10, 5)),
        _meal(date(2026, 10, 6), 10, calories=450),
        _meal(date(2026, 10, 6), 13, calories=550),
        _meal(end, 9, calories=600),
        _meal(end, 13, calories=600),
        _meal(end, 19, calories=600),
    ]
    digest = _digest(entries, _local(end, 21))
    by_day = {day.day: day for day in digest.days}

    assert by_day[date(2026, 10, 1)].counts_as_empty
    assert by_day[date(2026, 10, 2)].counts_as_single
    assert by_day[date(2026, 10, 3)].gaps
    assert by_day[date(2026, 10, 3)].gaps[0].hours == 9
    assert by_day[date(2026, 10, 3)].gaps[0].start.strftime("%H:%M") == "09:00"
    assert by_day[date(2026, 10, 3)].gaps[0].end.strftime("%H:%M") == "18:00"
    assert by_day[date(2026, 10, 4)].gaps == []
    assert by_day[date(2026, 10, 5)].counts_as_empty
    assert by_day[date(2026, 10, 5)].activity_calories == 200
    assert digest.logged_days == 5
    logged_calories = [400, 1000, 1000, 1000, 1800]
    assert digest.average_calories == sum(logged_calories) / len(logged_calories)

    facts = digest_facts(digest)
    texts = [item["text"] for item in facts["skips"]]
    assert any("1 октября" in text and "дневник пустой" in text for text in texts)
    assert any("2 октября" in text and "только один приём" in text for text in texts)
    assert any("3 октября" in text and "09:00" in text and "18:00" in text and "9 часов" in text for text in texts)
    assert facts["goal"] == "lose"
    assert facts["targets"]["calories"] == 2000
    assert "4 октября" not in " ".join(texts)
    assert "6 октября" not in " ".join(texts)


def test_exact_six_hour_gap_is_not_a_skip() -> None:
    day = date(2026, 10, 7)
    digest = _digest(
        [_meal(day, 9), _meal(day, 15)],
        _local(day, 21),
    )
    today = digest.days[-1]
    assert today.gaps == []
    assert digest_facts(digest)["skips"] == [] or all(
        "15:00" not in item["text"] for item in digest_facts(digest)["skips"]
    )


def test_unfinished_today_is_not_an_empty_or_single_skip() -> None:
    end = date(2026, 10, 7)
    digest = _digest([_meal(end, 9, title="йогурт")], _local(end, 10))
    today = digest.days[-1]
    assert today.incomplete
    assert not today.counts_as_empty
    assert not today.counts_as_single
    assert digest.logged_days == 1
    texts = " ".join(item["text"] for item in digest_facts(digest)["skips"])
    assert "7 октября" not in texts


def test_long_gap_on_unfinished_today_is_still_a_skip() -> None:
    end = date(2026, 10, 7)
    digest = _digest(
        [_meal(end, 8, title="каша"), _meal(end, 16, title="суп")],
        _local(end, 17),
    )
    texts = [item["text"] for item in digest_facts(digest)["skips"]]
    gap = next(text for text in texts if "08:00" in text)
    assert "16:00" in gap
    assert "приём пропущен" in gap
    assert "7 октября" in gap


def test_week_message_uses_fact_skips_when_model_drops_one() -> None:
    end = date(2026, 10, 7)
    digest = _digest([_meal(date(2026, 10, 2), 12)], _local(end, 21))
    facts = digest_facts(digest)
    review = CoachWeekReview(
        summary="Белок ниже нормы, а 2 октября <пропуск>.",
        wins=["Есть запись 2 октября"],
        improve=["Добавить второй приём"],
        skipped=[],
        next_steps=["Завтрак и ужин"],
    )
    text = format_week_message(review, facts)
    assert "Разбор недели" in text
    assert "Записано 1 из 7 дней" in text
    assert "Среднее 500 ккал при норме 2000" in text
    assert "2 октября" in text
    assert "только один приём" in text
    assert "так лучше не делать" in text
    assert "<b>Что улучшить</b>" in text
    assert "&lt;пропуск&gt;" in text
    assert "<пропуск>" not in text


def test_week_message_keeps_model_skip_lines_when_count_matches() -> None:
    facts = {
        "period": {"label": "5–11 октября"},
        "logged_days": 3,
        "days_in_period": 7,
        "average_calories": 1700,
        "targets": {"calories": 1800},
        "skips": [{"text": "факт"}],
    }
    review = CoachWeekReview(
        summary="Неделя ровная.",
        wins=[],
        improve=["Больше белка"],
        skipped=["7 октября между 8:10 и 15:40 пауза 7 часов — приём пропущен, так лучше не делать"],
        next_steps=["Держать три приёма"],
    )
    text = format_week_message(review, facts)
    assert "8:10" in text
    assert "факт" not in text


def test_week_review_requires_subscription() -> None:
    user = User(id=1, telegram_id=1, timezone="Europe/Moscow")
    assert week_review_allowed(user) is False
    user.subscription_until = datetime.now(timezone.utc) + timedelta(days=3)
    assert week_review_allowed(user) is True
    active = format_subscription_status(user)
    assert "ИИ-помощник" in active
    assert "пропущен приём" in active
    assert "/ai" in active
    user.subscription_until = datetime.now(timezone.utc) - timedelta(days=1)
    inactive = format_subscription_status(user)
    assert "Подписка не активна" in inactive
    assert "ИИ-помощник" in inactive
    assert "что улучшить" in inactive
    assert "/ai" in inactive


def test_decide_week_action_paywall_cache_and_refresh() -> None:
    assert decide_week_action(
        subscribed=False,
        logged_days=5,
        has_cache=True,
        refresh=False,
        refresh_used=False,
    ) == "paywall"
    assert decide_week_action(
        subscribed=True,
        logged_days=0,
        has_cache=True,
        refresh=False,
        refresh_used=False,
    ) == "cache"
    assert decide_week_action(
        subscribed=True,
        logged_days=5,
        has_cache=True,
        refresh=True,
        refresh_used=True,
    ) == "refresh_spent"
    assert decide_week_action(
        subscribed=True,
        logged_days=1,
        has_cache=False,
        refresh=False,
        refresh_used=False,
    ) == "need_data"
    assert decide_week_action(
        subscribed=True,
        logged_days=MIN_LOGGED_DAYS,
        has_cache=False,
        refresh=False,
        refresh_used=False,
    ) == "generate"
    assert decide_week_action(
        subscribed=True,
        logged_days=MIN_LOGGED_DAYS,
        has_cache=True,
        refresh=True,
        refresh_used=False,
    ) == "refresh"


def test_parse_coach_review_from_fenced_json() -> None:
    raw = """```json
    {"summary": "Норма близко.", "wins": ["белок"], "improve": ["сахар"], "skipped": [], "next_steps": ["утро"]}
    ```"""
    review = parse_coach_review(raw)
    assert review.summary == "Норма близко."
    assert review.wins == ["белок"]


def test_parse_coach_review_requires_summary() -> None:
    with pytest.raises(ValueError):
        parse_coach_review('{"summary": "  ", "wins": []}')


def test_coach_prompt_includes_facts() -> None:
    prompt = build_coach_week_prompt({"goal": "lose", "skips": []})
    assert "lose" in prompt
    assert "Do not recalculate" in prompt


def test_should_send_sunday_review_only_after_19_for_subscribers() -> None:
    sunday_evening = _local(SUNDAY, 19)
    assert should_send_sunday_review(
        notifications_enabled=True,
        subscription_active=True,
        local_now=sunday_evening,
        logged_days=2,
        already_pushed=False,
    )
    assert not should_send_sunday_review(
        notifications_enabled=True,
        subscription_active=True,
        local_now=_local(SUNDAY, 18),
        logged_days=2,
        already_pushed=False,
    )
    assert not should_send_sunday_review(
        notifications_enabled=True,
        subscription_active=True,
        local_now=_local(SUNDAY - timedelta(days=1), 19),
        logged_days=2,
        already_pushed=False,
    )
    assert not should_send_sunday_review(
        notifications_enabled=False,
        subscription_active=True,
        local_now=sunday_evening,
        logged_days=2,
        already_pushed=False,
    )
    assert not should_send_sunday_review(
        notifications_enabled=True,
        subscription_active=False,
        local_now=sunday_evening,
        logged_days=2,
        already_pushed=False,
    )
    assert not should_send_sunday_review(
        notifications_enabled=True,
        subscription_active=True,
        local_now=sunday_evening,
        logged_days=1,
        already_pushed=False,
    )
    assert not should_send_sunday_review(
        notifications_enabled=True,
        subscription_active=True,
        local_now=sunday_evening,
        logged_days=2,
        already_pushed=True,
    )


def _subscriber() -> User:
    return User(
        id=1,
        telegram_id=100,
        timezone="Europe/Moscow",
        notifications_enabled=True,
        subscription_until=datetime(2026, 12, 1, tzinfo=timezone.utc),
    )


def _repo(entries: list[DayEntry], existing: CoachReview | None = None) -> AsyncMock:
    repo = AsyncMock()
    repo.get_coach_review.return_value = existing
    repo.ensure_default_profile.return_value = _profile()
    repo.get_entries_for_period.return_value = entries
    repo.save_coach_review.return_value = existing
    repo.claim_coach_push.return_value = True
    return repo


def _two_days() -> list[DayEntry]:
    return [
        _meal(date(2026, 10, 5), 9, title="каша", calories=400),
        _meal(date(2026, 10, 6), 13, title="суп", calories=600),
    ]


@pytest.mark.asyncio
async def test_sunday_push_sends_generated_review_once() -> None:
    repo = _repo(_two_days())
    bot = AsyncMock()
    compose = AsyncMock(return_value="<b>Разбор недели</b>")
    now = datetime(2026, 10, 11, 16, 5, tzinfo=timezone.utc)

    sent = await process_sunday_coach_pushes(
        bot,
        repo,
        [_subscriber()],
        now=now,
        compose=compose,
    )

    assert sent == 1
    compose.assert_awaited()
    repo.claim_coach_push.assert_awaited()
    bot.send_message.assert_awaited_once()
    assert bot.send_message.await_args.args[0] == 100


@pytest.mark.asyncio
async def test_sunday_push_reuses_review_for_the_same_period() -> None:
    existing = CoachReview(
        user_id=1,
        week_start=date(2026, 10, 5),
        facts={"period": {"end": "2026-10-11"}},
        review_text="уже готовый разбор",
        refresh_used=True,
    )
    repo = _repo(_two_days(), existing)
    bot = AsyncMock()
    compose = AsyncMock()

    sent = await process_sunday_coach_pushes(
        bot,
        repo,
        [_subscriber()],
        now=datetime(2026, 10, 11, 16, 5, tzinfo=timezone.utc),
        compose=compose,
    )

    assert sent == 1
    compose.assert_not_awaited()
    repo.save_coach_review.assert_not_awaited()
    assert bot.send_message.await_args.args[1] == "уже готовый разбор"


@pytest.mark.asyncio
async def test_sunday_push_skips_when_already_sent_or_too_early() -> None:
    existing = CoachReview(
        user_id=1,
        week_start=date(2026, 10, 5),
        facts={"period": {"end": "2026-10-11"}},
        review_text="разбор",
        push_sent_at=datetime(2026, 10, 11, 16, tzinfo=timezone.utc),
    )
    repo = _repo(_two_days(), existing)
    bot = AsyncMock()
    now = datetime(2026, 10, 11, 16, 30, tzinfo=timezone.utc)

    sent = await process_sunday_coach_pushes(bot, repo, [_subscriber()], now=now, compose=AsyncMock())
    assert sent == 0
    bot.send_message.assert_not_awaited()

    early = _repo(_two_days())
    await process_sunday_coach_pushes(
        bot,
        early,
        [_subscriber()],
        now=datetime(2026, 10, 11, 14, 0, tzinfo=timezone.utc),
        compose=AsyncMock(),
    )
    early.get_entries_for_period.assert_not_awaited()


@pytest.mark.asyncio
async def test_sunday_push_does_not_claim_when_model_fails() -> None:
    repo = _repo(_two_days())
    bot = AsyncMock()
    compose = AsyncMock(side_effect=RuntimeError("openai down"))

    sent = await process_sunday_coach_pushes(
        bot,
        repo,
        [_subscriber()],
        now=datetime(2026, 10, 11, 16, 5, tzinfo=timezone.utc),
        compose=compose,
    )

    assert sent == 0
    repo.claim_coach_push.assert_not_awaited()
    bot.send_message.assert_not_awaited()


@pytest.mark.asyncio
async def test_sunday_push_needs_two_logged_days() -> None:
    repo = _repo([_meal(date(2026, 10, 6), 12)])
    bot = AsyncMock()
    compose = AsyncMock()

    sent = await process_sunday_coach_pushes(
        bot,
        repo,
        [_subscriber()],
        now=datetime(2026, 10, 11, 16, 5, tzinfo=timezone.utc),
        compose=compose,
    )

    assert sent == 0
    compose.assert_not_awaited()
    bot.send_message.assert_not_awaited()


@pytest.mark.asyncio
async def test_forbidden_sunday_push_disables_notifications() -> None:
    repo = _repo(_two_days())
    bot = AsyncMock()
    bot.send_message.side_effect = TelegramForbiddenError(
        method=SendMessage(chat_id=100, text="x"),
        message="Forbidden: bot was blocked by the user",
    )

    sent = await process_sunday_coach_pushes(
        bot,
        repo,
        [_subscriber()],
        now=datetime(2026, 10, 11, 16, 5, tzinfo=timezone.utc),
        compose=AsyncMock(return_value="разбор"),
    )

    assert sent == 0
    repo.set_notifications_enabled.assert_awaited()


def test_coach_week_endpoint_returns_review(monkeypatch) -> None:
    from fastapi.testclient import TestClient

    from src.ai_analyzer import server

    async def fake_review(facts: dict) -> CoachWeekReview:
        assert facts["goal"] == "lose"
        return CoachWeekReview(
            summary="Белок близко к норме.",
            wins=["есть записи"],
            improve=["меньше пауз"],
            skipped=["7 октября дневник пустой — приём пищи пропущен, так лучше не делать"],
            next_steps=["три приёма"],
        )

    monkeypatch.setattr(server.runner, "write_week_review", fake_review)
    response = TestClient(server.app).post("/coach/week", json={"facts": {"goal": "lose"}})
    assert response.status_code == 200
    body = response.json()
    assert body["review"]["summary"] == "Белок близко к норме."
    assert "приём пищи пропущен" in body["review"]["skipped"][0]
