from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.bot.config import settings
from src.bot.handlers.subscription import format_subscription_status
from src.bot.services.request_limit import (
    RequestKind,
    UsageCounts,
    consume_request_grant,
    describe_daily_limits,
    effective_daily_request_limit,
    format_limit_reached_message,
    has_active_subscription,
    limit_status,
    limit_welcome_note,
    request_kind_for_input,
    request_policy,
    refund_request,
)
from src.db.models import Payment, User
from src.db.repository import UserRepository


def test_effective_daily_request_limit_uses_user_override() -> None:
    user = User(id=1, telegram_id=1, timezone="Europe/Moscow", daily_request_limit=12)
    assert effective_daily_request_limit(user) == 12


def test_effective_daily_request_limit_uses_default() -> None:
    user = User(id=1, telegram_id=1, timezone="Europe/Moscow", daily_request_limit=None, legacy_photo_quota=False)
    assert effective_daily_request_limit(user) == settings.free_photo_daily_limit


def test_effective_daily_request_limit_uses_subscription() -> None:
    now = datetime.now(timezone.utc)
    user = User(
        id=1,
        telegram_id=1,
        timezone="Europe/Moscow",
        daily_request_limit=None,
        subscription_until=now + timedelta(days=10),
    )
    assert has_active_subscription(user, now=now)
    assert effective_daily_request_limit(user) == settings.subscription_daily_request_limit


def test_effective_daily_request_limit_ignores_expired_subscription() -> None:
    now = datetime(2026, 7, 4, tzinfo=timezone.utc)
    user = User(
        id=1,
        telegram_id=1,
        timezone="Europe/Moscow",
        daily_request_limit=None,
        subscription_until=now - timedelta(days=1),
    )
    assert not has_active_subscription(user, now=now)
    assert effective_daily_request_limit(user) == settings.free_photo_daily_limit


def test_override_beats_active_subscription() -> None:
    now = datetime(2026, 7, 4, tzinfo=timezone.utc)
    user = User(
        id=1,
        telegram_id=1,
        timezone="Europe/Moscow",
        daily_request_limit=99,
        subscription_until=now + timedelta(days=10),
    )
    assert effective_daily_request_limit(user) == 99


def test_limit_welcome_note_with_support_link(monkeypatch) -> None:
    monkeypatch.setattr(settings, "telegram_feedback_chat", "taarelkachat")
    monkeypatch.setattr(settings, "telegram_bot_username", "taarelka_bot")
    user = User(id=1, telegram_id=1, timezone="Europe/Moscow", daily_request_limit=6)
    message = limit_welcome_note(user)
    assert "6 запросов в день" in message
    assert "фото, текст, голос и исправления" in message
    assert "оформить подписку" not in message
    assert "Чтобы увеличить лимит" not in message
    assert "чат поддержки" not in message


def test_format_limit_reached_message_with_support_link(monkeypatch) -> None:
    monkeypatch.setattr(settings, "telegram_feedback_chat", "taarelkachat")
    monkeypatch.setattr(settings, "telegram_bot_username", "taarelka_bot")
    user = User(id=1, telegram_id=1, timezone="Europe/Moscow", daily_request_limit=6)
    message = format_limit_reached_message(user)
    assert "6 в день" in message
    assert 'href="https://t.me/taarelka_bot?start=premium"' in message
    assert "оформите подписку" in message
    assert "Чтобы увеличить лимит" in message
    assert "\n\nВ подписке ещё:\n" in message
    assert "ИИ-помощник: разбор недели /ai" in message
    assert "аналитика активности" in message
    assert "продвинутая статистика: БЖУ к целям" in message
    assert "30 фото, безлимит текстовых и 30 голосовых" in message
    assert "100" not in message
    assert "фото, голос, текст и исправления" not in message
    assert "чат поддержки" not in message
    assert "taarelkachat" not in message


def test_legacy_photo_quota_keeps_six_photos_and_separate_text_voice() -> None:
    user = User(id=1, telegram_id=1, timezone="Europe/Moscow", legacy_photo_quota=True)
    policy = request_policy(user)
    assert policy.mode == "split"
    assert policy.photo_limit == settings.legacy_free_photo_daily_limit == 6
    assert policy.text_limit == settings.free_text_daily_limit == 60
    assert policy.voice_limit == settings.free_voice_daily_limit == 10
    note = limit_welcome_note(user)
    assert "6 фото, 60 текстовых и 10 голосовых запросов в день" in note
    assert "Исправления расходуют текстовые" in note
    status = format_subscription_status(user)
    assert "Бесплатно: 6 фото, 60 текстовых и 10 голосовых запросов в день" in status


def test_new_user_photo_limit_is_three() -> None:
    user = User(id=1, telegram_id=1, timezone="Europe/Moscow", legacy_photo_quota=False)
    assert request_policy(user).photo_limit == 3
    assert "дневного лимита фото (3 в день)" in format_limit_reached_message(user, RequestKind.PHOTO)
    assert "текстовых запросов (60 в день)" in format_limit_reached_message(user, RequestKind.TEXT)
    assert "голосовых запросов (10 в день)" in format_limit_reached_message(user, RequestKind.VOICE)


def test_subscriber_text_limit_message_hides_the_cap() -> None:
    user = User(
        id=1,
        telegram_id=1,
        timezone="Europe/Moscow",
        subscription_until=datetime.now(timezone.utc) + timedelta(days=3),
    )
    message = format_limit_reached_message(user, RequestKind.TEXT)
    assert "защита от чрезмерного числа текстовых запросов" in message
    assert "оформите подписку" not in message
    assert "продление не сбрасывает" in message
    assert "100" not in message
    assert "(30 в день)" in format_limit_reached_message(user, RequestKind.VOICE)


def test_limit_status_uses_photo_headline_for_free_and_subscription() -> None:
    free = User(id=1, telegram_id=1, timezone="Europe/Moscow", legacy_photo_quota=False)
    usage = UsageCounts(total=5, photo=1, text=4, voice=0)
    free_status = limit_status(free, usage)
    assert free_status["limit_mode"] == "split"
    assert free_status["daily_limit"] == 3
    assert free_status["requests_used_today"] == 1
    assert free_status["limits"] == {"photo": 3, "text": 60, "voice": 10}
    assert free_status["used"] == {"photo": 1, "text": 4, "voice": 0}

    subscribed = User(
        id=2,
        telegram_id=2,
        timezone="Europe/Moscow",
        legacy_photo_quota=True,
        subscription_until=datetime.now(timezone.utc) + timedelta(days=3),
    )
    paid = limit_status(subscribed, usage)
    assert paid["limit_mode"] == "split"
    assert paid["daily_limit"] == settings.subscription_daily_request_limit
    assert paid["requests_used_today"] == 1
    assert paid["limits"] == {
        "photo": settings.subscription_daily_request_limit,
        "text": settings.subscription_text_daily_limit,
        "voice": settings.subscription_voice_daily_limit,
    }
    assert "безлимит" in describe_daily_limits(subscribed)
    assert "100" not in describe_daily_limits(subscribed)


def test_request_kind_prefers_photo_then_voice() -> None:
    assert request_kind_for_input(has_image=True, has_audio=True, has_text=True) == RequestKind.PHOTO
    assert request_kind_for_input(has_image=False, has_audio=True, has_text=True) == RequestKind.VOICE
    assert request_kind_for_input(has_image=False, has_audio=False, has_text=True) == RequestKind.TEXT


def test_correction_and_food_charge_matching_kinds() -> None:
    root = Path(__file__).resolve().parents[1]
    food = (root / "src/bot/handlers/food.py").read_text()
    correction = (root / "src/bot/handlers/correction.py").read_text()
    mobile = (root / "src/mobile_api/analysis.py").read_text()
    assert "kind=RequestKind.PHOTO" in food
    assert "kind=RequestKind.VOICE" in food
    assert "kind=RequestKind.TEXT" in food
    assert "kind=RequestKind.TEXT" in correction
    assert "RequestKind.TEXT" in mobile


class _LimitRepo:
    def __init__(self) -> None:
        self.calls: list[tuple[str, int, bool]] = []

    async def try_consume_daily_request(self, user_id, usage_date, *, kind, limit, shared):
        del user_id, usage_date
        self.calls.append((kind, limit, shared))
        return True


@pytest.mark.asyncio
async def test_consume_keeps_separate_limits_for_subscribers() -> None:
    repo = _LimitRepo()
    legacy = User(id=1, telegram_id=1, timezone="Europe/Moscow", legacy_photo_quota=True)
    fresh = User(id=2, telegram_id=2, timezone="Europe/Moscow", legacy_photo_quota=False)
    subscribed = User(
        id=3,
        telegram_id=3,
        timezone="Europe/Moscow",
        legacy_photo_quota=True,
        subscription_until=datetime.now(timezone.utc) + timedelta(days=2),
    )

    await consume_request_grant(repo, legacy, RequestKind.PHOTO)  # type: ignore[arg-type]
    await consume_request_grant(repo, legacy, RequestKind.TEXT)  # type: ignore[arg-type]
    await consume_request_grant(repo, legacy, RequestKind.VOICE)  # type: ignore[arg-type]
    await consume_request_grant(repo, fresh, RequestKind.PHOTO)  # type: ignore[arg-type]
    await consume_request_grant(repo, subscribed, RequestKind.PHOTO)  # type: ignore[arg-type]
    await consume_request_grant(repo, subscribed, RequestKind.TEXT)  # type: ignore[arg-type]
    await consume_request_grant(repo, subscribed, RequestKind.VOICE)  # type: ignore[arg-type]

    assert repo.calls == [
        (RequestKind.PHOTO, 6, False),
        (RequestKind.TEXT, 60, False),
        (RequestKind.VOICE, 10, False),
        (RequestKind.PHOTO, 3, False),
        (RequestKind.PHOTO, settings.subscription_daily_request_limit, False),
        (RequestKind.TEXT, settings.subscription_text_daily_limit, False),
        (RequestKind.VOICE, settings.subscription_voice_daily_limit, False),
    ]


@pytest.mark.asyncio
async def test_refund_after_midnight_uses_the_original_usage_day(monkeypatch) -> None:
    from types import SimpleNamespace
    from src.bot.services import request_limit

    first_day = date(2026, 10, 25)
    monkeypatch.setattr(request_limit, "local_today", lambda zone: first_day)
    repo = SimpleNamespace(try_consume_daily_request=AsyncMock(return_value=True), refund_daily_request=AsyncMock())
    user = User(id=1, telegram_id=1, timezone="Europe/Minsk", legacy_photo_quota=False)
    grant = await consume_request_grant(repo, user, RequestKind.PHOTO)
    monkeypatch.setattr(request_limit, "local_today", lambda zone: first_day + timedelta(days=1))
    await refund_request(repo, user, grant)
    repo.refund_daily_request.assert_awaited_once_with(user.id, first_day, kind=RequestKind.PHOTO)


def test_channel_welcome_note(monkeypatch) -> None:
    from src.bot.services.links import channel_welcome_note

    monkeypatch.setattr(settings, "telegram_channel", "https://t.me/+Y1ttKmidISwyZjMy")
    note = channel_welcome_note()
    assert "канале ТАРЕЛКА" in note
    assert 'href="https://t.me/+Y1ttKmidISwyZjMy"' in note

    monkeypatch.setattr(settings, "telegram_channel", "")
    assert channel_welcome_note() == ""


@pytest.mark.asyncio
async def test_activate_subscription_from_now() -> None:
    now = datetime(2026, 7, 4, 12, 0, tzinfo=timezone.utc)
    user = User(id=1, telegram_id=1, timezone="Europe/Moscow")
    session = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.add = MagicMock()
    locked = MagicMock()
    locked.scalar_one.return_value = user
    session.execute = AsyncMock(return_value=locked)
    session.scalar = AsyncMock(return_value=None)
    repo = UserRepository(session)

    updated = await repo.activate_subscription(
        user,
        duration_days=30,
        charge_id="charge-1",
        stars_amount=150,
        now=now,
    )

    assert updated.subscription_until == now + timedelta(days=30)
    assert updated.subscription_last_notified_until is None
    payment = session.add.call_args[0][0]
    assert isinstance(payment, Payment)
    assert payment.telegram_payment_charge_id == "charge-1"
    assert payment.stars_amount == 150
    assert payment.subscription_until == updated.subscription_until


@pytest.mark.asyncio
async def test_activate_subscription_extends_existing_term() -> None:
    now = datetime(2026, 7, 4, 12, 0, tzinfo=timezone.utc)
    existing_until = now + timedelta(days=10)
    user = User(
        id=1,
        telegram_id=1,
        timezone="Europe/Moscow",
        subscription_until=existing_until,
        subscription_last_notified_until=existing_until,
    )
    session = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.add = MagicMock()
    locked = MagicMock()
    locked.scalar_one.return_value = user
    session.execute = AsyncMock(return_value=locked)
    session.scalar = AsyncMock(return_value=None)
    repo = UserRepository(session)

    updated = await repo.activate_subscription(
        user,
        duration_days=30,
        charge_id="charge-2",
        stars_amount=150,
        now=now,
    )

    assert updated.subscription_until == existing_until + timedelta(days=30)
    assert updated.subscription_last_notified_until is None
