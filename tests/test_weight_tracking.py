from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from src.db.models import (
    AchievementAward, Base, EntryType, Goal, HealthRecord, Profile, User,
    WeighInReminder, WeightGoal, WeightHistory, WeightReminderEvent,
    NotificationPreference, PushDelivery, PushDevice,
)
from src.db.repository import UserRepository
from src.db.session import get_session
from src.mobile_api.main import app
from src.mobile_api.tokens import issue_access_token
from src.shared.weight_reminders import reminder_delivery_valid, run_weigh_reminders_iteration
from src.shared.weight_tracking import achievements_payload, current_run, longest_run, record_weight, set_weight_goal


@pytest.fixture
async def weights():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async def sessions():
        async with factory() as session:
            yield session
    app.dependency_overrides[get_session] = sessions
    async with factory() as session:
        repo = UserRepository(session)
        user = await repo.get_or_create_user(-190001, "Europe/Minsk")
        owner = user.id
        await repo.upsert_profile(owner, weight_kg=80, height_cm=174, age=31,
                                  sex="female", goal=Goal.MAINTAIN, activity_level="moderate", daily_calorie_target=2100)
        other = await repo.get_or_create_user(-190002, "UTC")
        other_id = other.id
    headers = {"Authorization": f"Bearer {issue_access_token(owner)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=headers) as client:
        yield client, factory, owner, other_id
    app.dependency_overrides.clear()
    await engine.dispose()


async def test_optional_defaults_and_shared_bot_app_goal(weights):
    client, factory, owner, _ = weights
    data = (await client.get("/v1/achievements")).json()
    assert data["goal"] is None
    assert data["reminder"]["enabled"] is False
    assert data["reminder"]["weekday"] == 0
    assert data["reminder"]["local_time"] == "09:00"
    async with factory() as session:
        user = await session.get(User, owner)
        goal = await set_weight_goal(session, user, 70)
        goal_id = goal.id
    data = (await client.get("/v1/achievements")).json()
    assert data["goal"]["id"] == goal_id
    assert data["goal"]["direction"] == "lose"
    profile = (await client.get("/v1/profile")).json()
    assert profile["goal"] == "lose"
    assert profile["daily_calorie_target"] == 2100
    assert profile["weight_goal"]["id"] == goal_id
    assert (await client.put("/v1/profile", json={"goal": "gain"})).status_code == 409
    assert (await client.get("/v1/achievements", headers={"Authorization": "Bearer invalid"})).status_code == 401


async def test_new_weigh_ins_with_same_value_and_retries(weights):
    client, factory, owner, _ = weights
    body = {"weight_kg": 80, "operation_id": "first"}
    assert (await client.post("/v1/weight", json=body)).status_code == 200
    assert (await client.post("/v1/weight", json=body)).status_code == 200
    assert (await client.post("/v1/weight", json={**body, "weight_kg": 79})).status_code == 409
    assert (await client.post("/v1/weight", json={**body, "operation_id": "second"})).status_code == 200
    async with factory() as session:
        user = await session.get(User, owner)
        await record_weight(session, user, "80,0", operation_key="telegram:42:123")
        await record_weight(session, user, "80,0", operation_key="telegram:42:123")
        assert await session.scalar(select(func.count()).select_from(WeightHistory).where(WeightHistory.user_id == owner)) == 4
    await client.put("/v1/profile", json={"daily_calorie_target": 2200})
    assert len((await client.get("/v1/weight")).json()["weight"]) == 4


async def test_progress_replacement_completion_and_calories(weights):
    client, _, _, _ = weights
    data = (await client.put("/v1/weight-goal", json={"target_weight_kg": 70})).json()
    first = data["goal"]["id"]
    await client.post("/v1/weight", json={"weight_kg": 75, "operation_id": "middle"})
    goal = (await client.get("/v1/achievements")).json()["goal"]
    assert goal["progress"] == 0.5 and goal["start_weight_kg"] == 80
    unchanged = (await client.put("/v1/weight-goal", json={"target_weight_kg": 70, "expected_goal_id": first})).json()["goal"]
    assert unchanged["id"] == first and unchanged["start_weight_kg"] == 80 and unchanged["progress"] == 0.5
    assert (await client.post("/v1/weight-goal/complete", json={"goal_id": first})).status_code == 409
    assert (await client.put("/v1/weight-goal", json={"target_weight_kg": 68})).status_code == 409
    assert (await client.put("/v1/weight-goal", json={"target_weight_kg": 68, "expected_goal_id": first, "expected_weight_kg": 80})).status_code == 409
    data = (await client.put("/v1/weight-goal", json={"target_weight_kg": 68, "expected_goal_id": first, "expected_weight_kg": 75})).json()
    goal = data["goal"]
    assert goal["start_weight_kg"] == 75 and goal["progress"] == 0
    assert data["goal_history"][0]["status"] == "replaced"
    await client.post("/v1/weight", json={"weight_kg": 67.9, "operation_id": "reached"})
    data = (await client.get("/v1/achievements")).json()
    assert data["goal"] is None
    assert data["goal_history"][0]["id"] == goal["id"]
    assert data["goal_history"][0]["status"] == "completed"
    assert (await client.get("/v1/profile")).json()["goal"] == "lose"
    body = {"goal_id": goal["id"]}
    assert (await client.post("/v1/weight-goal/complete", json=body)).status_code == 200
    assert (await client.post("/v1/weight-goal/complete", json=body)).status_code == 200
    data = (await client.get("/v1/achievements")).json()
    assert data["goal"] is None and any(a["key"] == "weight_goal_completed" and a["earned"] for a in data["achievements"])
    assert (await client.get("/v1/profile")).json()["daily_calorie_target"] == 2100


async def test_onboarding_target_is_optional_and_atomic(weights):
    client, factory, _, other = weights
    headers = {"Authorization": f"Bearer {issue_access_token(other)}"}
    bad = await client.put("/v1/profile", headers=headers, json={"weight_kg": 90, "target_weight_kg": 80})
    assert bad.status_code == 422
    assert (await client.get("/v1/profile", headers=headers)).json()["weight_kg"] is None
    body = dict(weight_kg=90, height_cm=180, age=30, sex="male", goal="gain", activity_level="light", target_weight_kg=80)
    response = await client.put("/v1/profile", headers=headers, json=body)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["goal"] == "lose" and saved["is_complete"]
    assert saved["weight_goal"]["start_weight_kg"] == 90
    assert saved["weight_goal"]["target_weight_kg"] == 80
    retry = (await client.put("/v1/profile", headers=headers, json=body)).json()
    assert retry["weight_goal"]["id"] == saved["weight_goal"]["id"]
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(WeightHistory).where(WeightHistory.user_id == other)) == 1


async def test_imported_weight_is_current_without_copying_manual_history(weights, monkeypatch):
    client, factory, owner, _ = weights
    monkeypatch.setenv("HEALTH_CONNECT_ENABLED", "1")
    now = datetime.now(timezone.utc)
    async with factory() as session:
        record = await session.scalar(select(WeightHistory).where(WeightHistory.user_id == owner))
        record.recorded_at = now - timedelta(days=2)
        session.add(HealthRecord(user_id=owner, generation="test", record_type="Weight", external_id="scale-1", origin="scale.app",
                                 start_at=now-timedelta(hours=1), values={"weight_kg": 76}, updated_at=now))
        await session.commit()
    data = (await client.put("/v1/weight-goal", json={"target_weight_kg": 70})).json()
    assert data["current_weight_kg"] == 76
    assert data["goal"]["start_weight_kg"] == 76
    assert data["latest_measurement"]["source"] == "health_connect"
    assert len([row for row in data["weight_history"] if row["source"] == "manual"]) == 1
    assert (await client.get("/v1/profile")).json()["weight_kg"] == 80


async def test_badges_backfill_once_and_survive_interruption(weights):
    client, factory, owner, _ = weights
    now = datetime.now(timezone.utc)
    async with factory() as session:
        repo = UserRepository(session)
        for index in range(12):
            session.add(WeightHistory(user_id=owner, weight_kg=80, recorded_at=now-timedelta(weeks=index)))
        await session.commit()
        for index in range(30):
            await repo.create_entry(user_id=owner, entry_date=now.date()-timedelta(days=index), entry_type=EntryType.WATER, title="Вода", calories=0, volume_ml=250)
    data = (await client.get("/v1/achievements")).json()
    assert sum(a["earned"] for a in data["achievements"]) == 5
    await client.get("/v1/achievements")
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(AchievementAward).where(AchievementAward.user_id == owner)) == 5
        await session.execute(delete(WeightHistory).where(WeightHistory.user_id == owner))
        await session.commit()
    assert sum(a["earned"] for a in (await client.get("/v1/achievements")).json()["achievements"]) == 5


async def prepare_reminder(factory, owner, now, *, weekday=0, local_time="09:00", zone="Europe/Minsk"):
    async with factory() as session:
        user = await session.get(User, owner)
        user.timezone = zone
        record = await session.scalar(select(WeightHistory).where(WeightHistory.user_id == owner))
        record.recorded_at = now-timedelta(days=14)
        session.add(WeighInReminder(user_id=owner, enabled=True, weekday=weekday, local_time=local_time))
        await session.commit()


async def test_weekly_reminder_is_persistent_once_and_has_working_buttons(weights):
    _, factory, owner, _ = weights
    now = datetime(2026, 10, 26, 6, tzinfo=timezone.utc)
    await prepare_reminder(factory, owner, now)
    bot = AsyncMock()
    assert await run_weigh_reminders_iteration(bot, now=now, session_factory=factory) == 1
    assert await run_weigh_reminders_iteration(bot, now=now+timedelta(minutes=1), session_factory=factory) == 0
    bot.send_message.assert_awaited_once()
    markup = bot.send_message.call_args.kwargs["reply_markup"]
    assert [b.callback_data for row in markup.inline_keyboard for b in row] == ["ach:weigh", "ach:reminder_off"]
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(WeightReminderEvent)) == 1


async def test_week_measurement_and_global_off_suppress_reminders(weights):
    _, factory, owner, _ = weights
    now = datetime(2026, 10, 26, 6, tzinfo=timezone.utc)
    await prepare_reminder(factory, owner, now)
    async with factory() as session:
        user = await session.get(User, owner)
        await record_weight(session, user, 80, operation_key="telegram:1:2", now=now-timedelta(hours=1))
    bot = AsyncMock()
    assert await run_weigh_reminders_iteration(bot, now=now, session_factory=factory) == 0
    bot.send_message.assert_not_awaited()
    async with factory() as session:
        user = await session.get(User, owner)
        assert not await reminder_delivery_valid(session, user, "weigh:2026-10-26", now)
        user.notifications_enabled = False
        await session.commit()
    assert await run_weigh_reminders_iteration(bot, now=now+timedelta(weeks=1), session_factory=factory) == 0


@pytest.mark.parametrize("first,second", [
    (datetime(2026, 10, 25, 0, 30, tzinfo=timezone.utc), datetime(2026, 10, 25, 1, 30, tzinfo=timezone.utc)),
    (datetime(2026, 3, 29, 1, 30, tzinfo=timezone.utc), datetime(2026, 3, 29, 2, 30, tzinfo=timezone.utc)),
])
async def test_dst_and_no_catchup_on_following_day(weights, first, second):
    _, factory, owner, _ = weights
    await prepare_reminder(factory, owner, first, weekday=6, local_time="02:30", zone="Europe/Berlin")
    bot = AsyncMock()
    assert await run_weigh_reminders_iteration(bot, now=first, session_factory=factory) == 1
    assert await run_weigh_reminders_iteration(bot, now=second, session_factory=factory) == 0
    assert await run_weigh_reminders_iteration(bot, now=first+timedelta(days=1), session_factory=factory) == 0
    bot.send_message.assert_awaited_once()


async def test_reminder_configuration_and_account_isolation(weights):
    client, factory, owner, other = weights
    assert (await client.put("/v1/settings/weigh-in-reminder", json={"enabled": True, "weekday": 3, "local_time": "08:15"})).status_code == 200
    assert (await client.put("/v1/settings/weigh-in-reminder", json={"enabled": True, "weekday": 7})).status_code == 422
    assert (await client.put("/v1/settings/weigh-in-reminder", json={"enabled": True, "local_time": "25:30"})).status_code == 422
    goal = (await client.put("/v1/weight-goal", json={"target_weight_kg": 70})).json()["goal"]
    headers = {"Authorization": f"Bearer {issue_access_token(other)}"}
    assert (await client.get("/v1/achievements", headers=headers)).json()["goal"] is None
    assert (await client.delete(f'/v1/weight-goal?goal_id={goal["id"]}', headers=headers)).status_code == 409
    assert (await client.delete(f'/v1/weight-goal?goal_id={goal["id"]}')).status_code == 200
    async with factory() as session:
        user = await session.get(User, owner)
        user.notifications_enabled = False
        await session.commit()
    paused = await client.put("/v1/settings/weigh-in-reminder", json={"enabled": True, "weekday": 4, "local_time": "10:00"})
    assert paused.status_code == 200 and not paused.json()["effective_enabled"]
    assert (await client.put("/v1/settings/weigh-in-reminder", json={"enabled": False})).status_code == 200
    assert (await client.put("/v1/settings/weigh-in-reminder", json={"enabled": True})).status_code == 409


async def test_delete_user_cascades_weight_data(weights):
    client, factory, owner, _ = weights
    await client.put("/v1/weight-goal", json={"target_weight_kg": 70})
    await client.put("/v1/settings/weigh-in-reminder", json={"enabled": True})
    await client.get("/v1/achievements")
    async with factory() as session:
        session.add(WeightReminderEvent(user_id=owner, week_start=datetime.now().date(), local_date=datetime.now().date(), status="sent"))
        await session.commit()
        await session.delete(await session.get(User, owner))
        await session.commit()
        for model in [WeightHistory, WeightGoal, WeighInReminder, WeightReminderEvent, AchievementAward]:
            assert await session.scalar(select(func.count()).select_from(model).where(model.user_id == owner)) == 0


async def test_queued_app_reminder_is_cancelled_after_health_measurement(weights, monkeypatch):
    _, factory, owner, _ = weights
    now = datetime(2026, 10, 26, 6, tzinfo=timezone.utc)
    await prepare_reminder(factory, owner, now)
    async with factory() as session:
        session.add(NotificationPreference(user_id=owner, channel="app"))
        session.add(PushDevice(user_id=owner, token="ExpoPushToken[test-device]", enabled=True, platform="android"))
        await session.commit()
    assert await run_weigh_reminders_iteration(AsyncMock(), now=now, session_factory=factory) == 1
    async with factory() as session:
        pending = await session.scalar(select(PushDelivery))
        assert pending.payload["data"]["path"] == "/weight"
        pending.updated_at = now-timedelta(minutes=1)
        session.add(HealthRecord(user_id=owner, generation="test", record_type="Weight", external_id="after-reminder", origin="scale.app",
                                 start_at=now, values={"weight_kg": 80}, updated_at=now))
        await session.commit()
    from src.shared import notifications
    class Clock:
        @staticmethod
        def now(zone):
            return now+timedelta(minutes=1)
    client, manager = AsyncMock(), AsyncMock()
    manager.__aenter__.return_value = client
    monkeypatch.setattr(notifications, "async_session_factory", factory)
    monkeypatch.setattr(notifications, "datetime", Clock)
    monkeypatch.setattr(notifications.httpx, "AsyncClient", lambda **kwargs: manager)
    await notifications.process_pushes()
    client.post.assert_not_awaited()
    async with factory() as session:
        assert (await session.scalar(select(PushDelivery))).status == "cancelled"


def test_locked_badge_progress_uses_current_streak_while_backfill_uses_longest():
    today = datetime(2026, 10, 26).date()
    days = [today-timedelta(days=10), today-timedelta(days=9), today-timedelta(days=8), today]
    assert longest_run(days) == 3
    assert current_run(days, today) == 1
    weeks = [today-timedelta(weeks=5), today-timedelta(weeks=4), today-timedelta(weeks=3), today]
    assert longest_run(weeks, 7) == 3
    assert current_run(weeks, today, 7) == 1


async def test_default_email_app_channel_delivers_without_an_explicit_preference(weights, monkeypatch):
    _, factory, owner, _ = weights
    now = datetime(2026, 10, 26, 6, tzinfo=timezone.utc)
    await prepare_reminder(factory, owner, now)
    async with factory() as session:
        user = await session.get(User, owner)
        user.telegram_id, user.email, user.password_hash = None, "push@example.test", "test-password-hash"
        session.add(PushDevice(user_id=owner, token="ExpoPushToken[email-device]", enabled=True, platform="ios"))
        await session.commit()
    bot = AsyncMock()
    assert await run_weigh_reminders_iteration(bot, now=now, session_factory=factory) == 1
    bot.send_message.assert_not_awaited()
    async with factory() as session:
        delivery = await session.scalar(select(PushDelivery))
        delivery.updated_at = now-timedelta(minutes=1)
        await session.commit()
    from src.shared import notifications
    class Clock:
        @staticmethod
        def now(zone):
            return now+timedelta(minutes=1)
    client, manager, response = AsyncMock(), AsyncMock(), MagicMock()
    response.json.return_value = {"data": {"status": "ok", "id": "fake-ticket"}}
    client.post.return_value = response
    manager.__aenter__.return_value = client
    monkeypatch.setattr(notifications, "async_session_factory", factory)
    monkeypatch.setattr(notifications, "datetime", Clock)
    monkeypatch.setattr(notifications.httpx, "AsyncClient", lambda **kwargs: manager)
    await notifications.process_pushes()
    client.post.assert_awaited_once()
    async with factory() as session:
        assert (await session.scalar(select(PushDelivery))).status == "ticket"
