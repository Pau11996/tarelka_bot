import asyncio
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.bot.handlers import coach
from src.db.models import Base, CoachReview, Payment, User
from src.db.repository import UserRepository


@pytest_asyncio.fixture
async def sessions():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.mark.asyncio
async def test_replayed_payment_is_idempotent_and_stale_renewal_keeps_paid_days(sessions):
    now = datetime(2026, 10, 15, tzinfo=timezone.utc)
    async with sessions() as stale_session:
        stale_user = User(telegram_id=123, timezone="Europe/Minsk")
        stale_session.add(stale_user)
        await stale_session.commit()
        async with sessions() as session:
            user = await session.get(User, stale_user.id)
            repo = UserRepository(session)
            for _ in range(2):
                await repo.activate_subscription(user, duration_days=30, charge_id="payment-one",
                                                 stars_amount=150, now=now)
            assert await session.scalar(select(func.count()).select_from(Payment)) == 1
            assert user.subscription_until.replace(tzinfo=timezone.utc) == now + timedelta(days=30)
        # This object predates the first payment, as can happen with concurrent updates.
        assert stale_user.subscription_until is None
        await UserRepository(stale_session).activate_subscription(
            stale_user, duration_days=30, charge_id="payment-two", stars_amount=150, now=now)
        assert stale_user.subscription_until.replace(tzinfo=timezone.utc) == now + timedelta(days=60)


@pytest.mark.asyncio
async def test_failed_push_claim_is_released_only_by_its_owner(sessions):
    week = date(2026, 10, 12)
    now = datetime(2026, 10, 18, 17, tzinfo=timezone.utc)
    async with sessions() as session:
        user = User(telegram_id=456, timezone="Europe/Minsk")
        session.add(user)
        await session.commit()
        session.add(CoachReview(user_id=user.id, week_start=week, facts={}, review_text="Отчёт"))
        await session.commit()
        repo = UserRepository(session)
        assert await repo.claim_coach_push(user_id=user.id, week_start=week, now=now)
        await repo.release_coach_push(user_id=user.id, week_start=week, claimed_at=now-timedelta(seconds=1))
        assert not await repo.claim_coach_push(user_id=user.id, week_start=week, now=now)
        await repo.release_coach_push(user_id=user.id, week_start=week, claimed_at=now)
        assert await repo.claim_coach_push(user_id=user.id, week_start=week, now=now+timedelta(minutes=20))


@pytest.mark.asyncio
async def test_refresh_acknowledges_callback_before_generation(monkeypatch):
    callback = SimpleNamespace(message=SimpleNamespace(edit_reply_markup=AsyncMock()),
                               from_user=SimpleNamespace(id=123), answer=AsyncMock())
    repo = SimpleNamespace(get_or_create_user=AsyncMock(return_value=object()))
    monkeypatch.setattr(coach, "UserRepository", lambda session: repo)
    monkeypatch.setattr(coach, "week_review_allowed", lambda user: True)

    async def generate(*args, **kwargs):
        callback.answer.assert_awaited_once()
        return "refresh"

    monkeypatch.setattr(coach, "_open_week", generate)
    await coach.refresh_week(callback, SimpleNamespace(clear=AsyncMock()), None, None)
    callback.answer.assert_awaited_once()
    callback.message.edit_reply_markup.assert_awaited_once()


@pytest.mark.asyncio
async def test_double_click_does_not_start_second_review_and_cancel_releases_guard(monkeypatch):
    started, release = asyncio.Event(), asyncio.Event()

    async def generate(*args, **kwargs):
        started.set()
        await release.wait()
        return "generate"

    writer = AsyncMock(side_effect=generate)
    monkeypatch.setattr(coach, "_open_week_once", writer)
    monkeypatch.setattr(coach, "answer_persistent", AsyncMock())
    task = asyncio.create_task(coach._open_week(None, None, None, telegram_id=999, refresh=False))
    await started.wait()
    try:
        assert await coach._open_week(None, None, None, telegram_id=999, refresh=False) == "busy"
        writer.assert_awaited_once()
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert 999 not in coach._reviews_in_progress
    release.set()
    assert await coach._open_week(None, None, None, telegram_id=999, refresh=False) == "generate"
