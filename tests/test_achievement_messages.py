from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select

from test_weight_tracking import weights
from test_health_connect import health_api, connect, batch, send
from src.db.models import AchievementAward, AchievementMessage, NotificationPreference, User, WeightGoal, WeightHistory
from src.mobile_api.tokens import issue_access_token
from src.shared.achievement_messages import deliver_goal_messages
from src.shared.weight_tracking import record_weight, set_weight_goal


def first_badge(payload):
    return next(item for item in payload["achievements"] if item["key"] == "first_weigh_in")


async def test_initial_profile_weight_is_baseline_and_same_value_next_weigh_in_earns_badge(weights):
    client, factory, owner, _ = weights
    for _ in range(2):
        badge = first_badge((await client.get("/v1/achievements")).json())
        assert not badge["earned"] and badge["progress"] == 0 and badge["target"] == 1
    await client.put("/v1/profile", json={"daily_calorie_target": 2200})
    assert not first_badge((await client.get("/v1/achievements")).json())["earned"]
    for _ in range(2):
        assert (await client.post("/v1/weight", json={"weight_kg": 80, "operation_id": "second-actual-weight"})).status_code == 200
    badge = first_badge((await client.get("/v1/achievements")).json())
    assert badge["earned"] and badge["progress"] == 1
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(WeightHistory).where(WeightHistory.user_id == owner)) == 2
        assert await session.scalar(select(func.count()).select_from(AchievementAward).where(AchievementAward.user_id == owner)) == 1


async def test_without_profile_weight_first_chat_weight_is_baseline_and_next_is_rewarded(weights):
    client, factory, _, other = weights
    headers = {"Authorization": f"Bearer {issue_access_token(other)}"}
    await client.post("/v1/weight", headers=headers, json={"weight_kg": 79, "operation_id": "initial"})
    assert not first_badge((await client.get("/v1/achievements", headers=headers)).json())["earned"]
    async with factory() as session:
        user = await session.get(User, other)
        await record_weight(session, user, 79, operation_key="telegram:1:123")
    assert first_badge((await client.get("/v1/achievements", headers=headers)).json())["earned"]


@pytest.mark.parametrize("target,reached,away", [(70, 69.8, 72), (90, 90.2, 88)])
async def test_goal_congratulations_is_automatic_shared_and_once_per_goal(weights, target, reached, away):
    client, factory, owner, other = weights
    goal = (await client.put("/v1/weight-goal", json={"target_weight_kg": target})).json()["goal"]
    assert (await client.get("/v1/chat")).json()["notices"] == []
    for _ in range(2):
        await client.post("/v1/weight", json={"weight_kg": reached, "operation_id": "reached"})
    notices = (await client.get("/v1/chat")).json()["notices"]
    assert len(notices) == 1 and "достигнута" in notices[0]["title"]
    assert (await client.get("/v1/chat/notices")).json()["notices"] == notices
    assert str(target) in notices[0]["message"] and str(reached).replace(".", ",") in notices[0]["message"]
    for value, key in [(away, "away"), (reached, "again")]:
        await client.post("/v1/weight", json={"weight_kg": value, "operation_id": key})
    assert (await client.get("/v1/chat")).json()["notices"] == notices
    tracking = (await client.get("/v1/achievements")).json()
    assert tracking["goal"] is None and tracking["goal_history"][0]["status"] == "completed"
    assert any(award["key"] == "weight_goal_completed" and award["earned"] for award in tracking["achievements"])
    assert (await client.get("/v1/profile")).json()["daily_calorie_target"] == 2100
    headers = {"Authorization": f"Bearer {issue_access_token(other)}"}
    assert (await client.get("/v1/chat", headers=headers)).json()["notices"] == []
    assert (await client.get("/v1/chat/notices", headers=headers)).json()["notices"] == []
    bot = AsyncMock()
    assert await deliver_goal_messages(bot, session_factory=factory) == 1
    assert await deliver_goal_messages(bot, session_factory=factory) == 0
    bot.send_message.assert_awaited_once()
    assert bot.send_message.call_args.args[0] == -190001
    assert "Цель по весу достигнута!" in bot.send_message.call_args.args[1]
    assert [row[0].callback_data for row in bot.send_message.call_args.kwargs["reply_markup"].inline_keyboard] == ["ach:goal", "ach:home"]
    await client.post("/v1/weight-goal/complete", json={"goal_id": goal["id"]})
    assert (await client.get("/v1/chat")).json()["notices"] == notices
    # The new goal has its own event, while previous congratulations remain in history.
    next_target = reached - 1 if target < 80 else reached + 1
    await client.put("/v1/weight-goal", json={"target_weight_kg": next_target})
    await client.post("/v1/weight", json={"weight_kg": next_target, "operation_id": "next-goal"})
    assert len((await client.get("/v1/chat")).json()["notices"]) == 2
    async with factory() as session:
        await session.delete(await session.get(User, owner))
        await session.commit()
        assert await session.scalar(select(func.count()).select_from(AchievementMessage).where(AchievementMessage.user_id == owner)) == 0


async def test_telegram_weigh_in_also_creates_app_chat_message(weights):
    client, factory, owner, _ = weights
    async with factory() as session:
        user = await session.get(User, owner)
        await set_weight_goal(session, user, 70)
        await record_weight(session, user, 70, operation_key="telegram:42:123")
    assert len((await client.get("/v1/chat")).json()["notices"]) == 1


async def test_maintenance_goal_does_not_congratulate_on_creation(weights):
    client, _, _, _ = weights
    await client.put("/v1/weight-goal", json={"target_weight_kg": 80})
    assert (await client.get("/v1/chat")).json()["notices"] == []
    await client.post("/v1/weight", json={"weight_kg": 80, "operation_id": "maintained"})
    assert (await client.get("/v1/chat")).json()["notices"] == []
    assert (await client.get("/v1/achievements")).json()["goal"]["status"] == "active"


@pytest.mark.parametrize("channel", ["app", "off"])
async def test_app_message_remains_when_telegram_channel_is_not_selected(weights, channel):
    client, factory, owner, _ = weights
    async with factory() as session:
        session.add(NotificationPreference(user_id=owner, channel=channel))
        await session.commit()
    await client.put("/v1/weight-goal", json={"target_weight_kg": 70})
    await client.post("/v1/weight", json={"weight_kg": 70, "operation_id": "reached"})
    bot = AsyncMock()
    assert await deliver_goal_messages(bot, session_factory=factory) == 0
    bot.send_message.assert_not_awaited()
    assert len((await client.get("/v1/chat")).json()["notices"]) == 1


async def test_unknown_telegram_delivery_outcome_is_not_repeated_after_restart(weights):
    client, factory, _, _ = weights
    await client.put("/v1/weight-goal", json={"target_weight_kg": 70})
    await client.post("/v1/weight", json={"weight_kg": 70, "operation_id": "reached"})
    bot = AsyncMock()
    bot.send_message.side_effect = TimeoutError("unknown delivery outcome")
    assert await deliver_goal_messages(bot, session_factory=factory) == 0
    assert await deliver_goal_messages(bot, session_factory=factory) == 0
    bot.send_message.assert_awaited_once()
    assert len((await client.get("/v1/chat")).json()["notices"]) == 1


async def test_health_sync_reaches_goal_and_awards_second_measurement_without_opening_achievements(health_api):
    client, factory, owner, _ = health_api
    # Ensure the imported measurement is later than the profile baseline.
    async with factory() as session:
        baseline = await session.scalar(select(WeightHistory).where(WeightHistory.user_id == owner))
        baseline.recorded_at = datetime.now(timezone.utc) - timedelta(days=2)
        await session.commit()
    await client.put("/v1/weight-goal", json={"target_weight_kg": 75})
    config = await connect(client)
    payload = batch(config)
    payload["records"] = [payload["records"][0]]
    payload["records"][0]["start_at"] = datetime.now(timezone.utc).isoformat()
    await send(client, payload)
    await send(client, payload)
    notices = (await client.get("/v1/chat")).json()["notices"]
    assert len(notices) == 1
    async with factory() as session:
        assert await session.get(AchievementAward, (owner, "first_weigh_in"))
        assert await session.scalar(select(func.count()).select_from(WeightHistory).where(WeightHistory.user_id == owner)) == 1


async def test_profile_weight_edit_reaches_goal_but_other_settings_do_not_weigh(weights):
    client, _, _, _ = weights
    await client.put("/v1/weight-goal", json={"target_weight_kg": 70})
    await client.put("/v1/profile", json={"daily_calorie_target": 2100})
    assert (await client.get("/v1/chat")).json()["notices"] == []
    await client.put("/v1/profile", json={"weight_kg": 70})
    assert len((await client.get("/v1/chat")).json()["notices"]) == 1


async def test_message_and_award_roll_back_with_measurement(weights):
    _, factory, owner, _ = weights
    from src.mobile_api.worker import AtomicSession
    from sqlalchemy.ext.asyncio import async_sessionmaker

    async with factory() as session:
        user = await session.get(User, owner)
        await set_weight_goal(session, user, 70)
    atomic = async_sessionmaker(factory.kw["bind"], class_=AtomicSession, expire_on_commit=False)
    async with atomic() as session:
        user = await session.get(User, owner)
        await record_weight(session, user, 70, operation_key="rolled-back")
        assert await session.scalar(select(func.count()).select_from(AchievementMessage)) == 1
        assert (await session.scalar(select(WeightGoal))).status == "completed"
        await session.rollback()
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(AchievementMessage)) == 0
        assert await session.get(AchievementAward, (owner, "first_weigh_in")) is None
        assert (await session.scalar(select(WeightGoal))).status == "active"


async def test_historical_weigh_in_and_opening_overview_never_complete_goal(weights):
    client, factory, owner, _ = weights
    async with factory() as session:
        baseline = await session.scalar(select(WeightHistory).where(WeightHistory.user_id == owner))
        baseline.recorded_at = datetime.now(timezone.utc) - timedelta(days=2)
        await session.commit()
    goal = (await client.put("/v1/weight-goal", json={"target_weight_kg": 70})).json()["goal"]
    async with factory() as session:
        user = await session.get(User, owner)
        await record_weight(session, user, 70, operation_key="old", now=datetime.now(timezone.utc)-timedelta(days=1))
    for _ in range(2):
        data = (await client.get("/v1/achievements")).json()
        assert data["goal"]["id"] == goal["id"] and data["goal"]["status"] == "active"
        assert (await client.get("/v1/chat")).json()["notices"] == []
    await client.post("/v1/weight", json={"weight_kg": 70, "operation_id": "new-after-goal"})
    data = (await client.get("/v1/achievements")).json()
    assert data["goal"] is None and data["goal_history"][0]["status"] == "completed"
    assert len((await client.get("/v1/chat")).json()["notices"]) == 1


async def test_old_health_import_does_not_complete_goal_but_new_measurement_does(health_api):
    client, factory, owner, _ = health_api
    async with factory() as session:
        baseline = await session.scalar(select(WeightHistory).where(WeightHistory.user_id == owner))
        baseline.recorded_at = datetime.now(timezone.utc)-timedelta(days=3)
        await session.commit()
    goal = (await client.put("/v1/weight-goal", json={"target_weight_kg": 75})).json()["goal"]
    config = await connect(client)
    payload = batch(config)
    old = datetime.now(timezone.utc)-timedelta(days=1)
    payload["start_date"] = old.date().isoformat()
    payload["reconcile"] = False
    payload["records"] = [payload["records"][0]]
    payload["records"][0]["start_at"] = old.isoformat()
    result = await send(client, payload)
    assert (await client.get("/v1/achievements")).json()["goal"]["id"] == goal["id"]
    assert (await client.get("/v1/chat")).json()["notices"] == []
    fresh = batch({**config, "revision": result["revision"]})
    fresh["records"] = [fresh["records"][0]]
    fresh["records"][0]["start_at"] = datetime.now(timezone.utc).isoformat()
    await send(client, fresh)
    await send(client, fresh)
    data = (await client.get("/v1/achievements")).json()
    assert data["goal"] is None and data["goal_history"][0]["status"] == "completed"
    assert len((await client.get("/v1/chat")).json()["notices"]) == 1


async def test_migration_retracts_only_premature_first_award(weights):
    _, factory, owner, other = weights
    async with factory() as session:
        session.add(AchievementAward(user_id=owner, key="first_weigh_in"))
        session.add(AchievementAward(user_id=owner, key="diary_7_days"))
        user = await session.get(User, other)
        await record_weight(session, user, 80, operation_key="initial")
        await record_weight(session, user, 80, operation_key="next")
    def migrate(connection):
        import importlib.util
        from pathlib import Path
        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        AchievementMessage.__table__.drop(connection)
        spec = importlib.util.spec_from_file_location("achievement_migration", Path(__file__).parents[1] / "migrations/versions/021_achievement_messages.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade()
    async with factory.kw["bind"].begin() as connection:
        await connection.run_sync(migrate)
    async with factory() as session:
        assert await session.get(AchievementAward, (owner, "first_weigh_in")) is None
        assert await session.get(AchievementAward, (owner, "diary_7_days"))
        assert await session.get(AchievementAward, (other, "first_weigh_in"))
