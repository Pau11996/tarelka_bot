from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.bot.config import settings
from src.bot.services.request_limit import (
    effective_daily_request_limit,
    format_limit_reached_message,
    has_active_subscription,
    limit_welcome_note,
)
from src.db.models import Payment, User
from src.db.repository import UserRepository


def test_effective_daily_request_limit_uses_user_override() -> None:
    user = User(id=1, telegram_id=1, timezone="Europe/Moscow", daily_request_limit=12)
    assert effective_daily_request_limit(user) == 12


def test_effective_daily_request_limit_uses_default() -> None:
    user = User(id=1, telegram_id=1, timezone="Europe/Moscow", daily_request_limit=None)
    assert effective_daily_request_limit(user) == settings.daily_request_limit


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
    assert effective_daily_request_limit(user) == settings.daily_request_limit


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


def test_format_limit_reached_message_with_support_link(monkeypatch) -> None:
    monkeypatch.setattr(settings, "telegram_feedback_chat", "taarelkachat")
    monkeypatch.setattr(settings, "telegram_bot_username", "taarelka_bot")
    user = User(id=1, telegram_id=1, timezone="Europe/Moscow", daily_request_limit=6)
    message = format_limit_reached_message(user)
    assert "6 в день" in message
    assert 'href="https://t.me/taarelka_bot?start=premium"' in message
    assert "оформить подписку" in message
    assert "либо напишите в" in message
    assert "чат поддержки" in message
    assert 'href="https://t.me/taarelkachat"' in message


def test_limit_welcome_note_with_support_link(monkeypatch) -> None:
    monkeypatch.setattr(settings, "telegram_feedback_chat", "taarelkachat")
    monkeypatch.setattr(settings, "telegram_bot_username", "taarelka_bot")
    user = User(id=1, telegram_id=1, timezone="Europe/Moscow", daily_request_limit=6)
    message = limit_welcome_note(user)
    assert "6 запросов в день" in message
    assert "фото, текст и исправления" in message
    assert 'href="https://t.me/taarelka_bot?start=premium"' in message
    assert "оформить подписку" in message
    assert "либо напишите в" in message
    assert 'href="https://t.me/taarelkachat"' in message


@pytest.mark.asyncio
async def test_activate_subscription_from_now() -> None:
    now = datetime(2026, 7, 4, 12, 0, tzinfo=timezone.utc)
    user = User(id=1, telegram_id=1, timezone="Europe/Moscow")
    session = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.add = MagicMock()
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
