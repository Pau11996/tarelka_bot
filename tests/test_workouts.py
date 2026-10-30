from copy import deepcopy
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from src.db.models import AIAnalysis, Base, DailyRequestUsage, DayEntry, Profile, WorkoutSession
from src.db.repository import UserRepository
from src.db.session import get_session
from src.mobile_api.main import app
from src.mobile_api.tokens import issue_access_token
from src.shared.workouts import EXERCISES, WORKOUTS, active_kcal


@pytest.fixture
async def workout_api():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    @event.listens_for(engine.sync_engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async def sessions():
        async with factory() as session:
            yield session
    app.dependency_overrides[get_session] = sessions
    async with factory() as session:
        repo = UserRepository(session)
        owner = await repo.get_or_create_user(-92001, "Europe/Minsk")
        owner_id = owner.id
        await repo.upsert_profile(owner_id, weight_kg=80, daily_calorie_target=2100)
        other = await repo.get_or_create_user(-92002, "UTC")
        other_id = other.id
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {issue_access_token(owner_id)}"}) as client:
        yield client, factory, owner_id, other_id
    app.dependency_overrides.clear()
    await engine.dispose()


def payload(auto_log=False, status="completed"):
    workout = WORKOUTS[0]
    start = datetime.now(timezone.utc) - timedelta(hours=1)
    return dict(workout_id=workout["id"], catalogue_version=1, status=status,
                started_at=start.isoformat(), ended_at=(start + timedelta(minutes=10)).isoformat(),
                timezone="Europe/Minsk", auto_log=auto_log,
                steps=[dict(step_id=s["id"], active_seconds=s["expected_seconds"],
                            rest_seconds=s["rest_seconds"], completed=True) for s in workout["steps"]])


async def save(client, body=None, id=None, expected=200):
    response = await client.put(f"/v1/workouts/sessions/{id or uuid4()}", json=body or payload())
    assert response.status_code == expected, response.text
    return response.json()


async def test_catalogue_and_defaults_available_without_subscription(workout_api):
    client, *_ = workout_api
    result = (await client.get("/v1/workouts/catalogue")).json()
    assert result["version"] == 1 and len(result["workouts"]) == 6
    ids = {exercise["id"] for exercise in result["exercises"]}
    for workout in result["workouts"]:
        assert all(s["exercise_id"] in ids for s in workout["steps"])
        assert workout["duration_seconds"] == sum(s["expected_seconds"] + s["rest_seconds"] for s in workout["steps"])
    assert (await client.get("/v1/settings/workouts")).json() == {"auto_log": False, "sound": True}
    response = await client.put("/v1/settings/workouts", json={"auto_log": True, "sound": False})
    assert response.json() == (await client.get("/v1/settings/workouts")).json()


async def test_history_without_diary_and_without_ai_usage(workout_api):
    client, factory, *_ = workout_api
    result = await save(client)
    assert result["calories"] > 0 and result["diary_entry_id"] is None
    assert result["steps"][0]["exercise_title"] == "Шаги на месте"
    assert (await client.get("/v1/workouts/history")).json()["items"][0]["id"] == result["id"]
    async with factory() as session:
        for model in (DayEntry, AIAnalysis, DailyRequestUsage):
            assert await session.scalar(select(func.count()).select_from(model)) == 0


async def test_auto_log_atomic_retry_and_deleted_entry_tombstone(workout_api):
    client, factory, *_ = workout_api
    body, id = payload(True), str(uuid4())
    first = await save(client, body, id)
    second = await save(client, body, id)
    assert first["diary_entry_id"] == second["diary_entry_id"]
    diary = (await client.get(f'/v1/days/{first["local_date"]}')).json()
    assert diary["balance"]["activity_bonus"] == first["calories"]
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(DayEntry)) == 1
    assert (await client.delete(f'/v1/entries/{first["diary_entry_id"]}')).status_code == 204
    retried = await save(client, body, id)
    assert retried["diary_added"] and retried["diary_entry_id"] is None
    manual = (await client.post(f"/v1/workouts/sessions/{id}/diary")).json()
    assert manual["diary_added"] and manual["diary_entry_id"] is None
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(DayEntry)) == 0


async def test_missing_weight_can_be_added_later_without_resaving_session(workout_api):
    client, factory, owner, *_ = workout_api
    async with factory() as session:
        profile = await session.scalar(select(Profile).where(Profile.user_id == owner))
        profile.weight_kg = None
        await session.commit()
    result = await save(client, payload(True))
    assert result["needs_weight"] and result["calories"] is None and not result["diary_added"]
    path = f'/v1/workouts/sessions/{result["id"]}/diary'
    assert (await client.post(path)).status_code == 422
    async with factory() as session:
        profile = await session.scalar(select(Profile).where(Profile.user_id == owner))
        profile.weight_kg = 65
        await session.commit()
    first = (await client.post(path)).json()
    second = (await client.post(path)).json()
    assert first["weight_kg"] == 65 and first["diary_entry_id"] == second["diary_entry_id"]


async def test_interrupted_and_all_skipped_do_not_create_diary_entries(workout_api):
    client, *_ = workout_api
    result = await save(client, payload(True, "interrupted"))
    assert result["diary_entry_id"] is None
    assert (await client.post(f'/v1/workouts/sessions/{result["id"]}/diary')).status_code == 409
    body = payload(True)
    for step in body["steps"]:
        step.update(active_seconds=0, completed=False)
    await save(client, body, expected=422)
    body["status"] = "interrupted"
    result = await save(client, body)
    assert result["active_seconds"] == 0 and not result["diary_added"]


async def test_account_isolation_and_full_account_deletion(workout_api):
    client, factory, _, other = workout_api
    result = await save(client, payload(True))
    headers = {"Authorization": f"Bearer {issue_access_token(other)}"}
    assert (await client.get("/v1/workouts/history", headers=headers)).json()["items"] == []
    assert (await client.post(f'/v1/workouts/sessions/{result["id"]}/diary', headers=headers)).status_code == 404
    assert (await client.delete("/v1/account")).status_code == 204
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(WorkoutSession)) == 0


async def test_timezone_snapshot_uses_session_start_not_sync_day(workout_api):
    client, *_ = workout_api
    body = payload(True)
    body.update(started_at="2026-03-28T23:50:00Z", ended_at="2026-03-29T00:20:00Z", timezone="Europe/Berlin")
    result = await save(client, body)
    assert result["local_date"] == "2026-03-29"


async def test_input_validation_and_conflicting_retries(workout_api):
    client, *_ = workout_api
    body, id = payload(), str(uuid4())
    await save(client, body, id)
    changed = deepcopy(body); changed["auto_log"] = True
    await save(client, changed, id, expected=409)
    for change in (dict(catalogue_version=999), dict(timezone="Not/AZone"), dict(steps=[])):
        await save(client, {**body, **change}, expected=422)
    for field, value in [("step_id", "unknown"), ("active_seconds", 999), ("active_seconds", -1), ("active_seconds", 2)]:
        changed = deepcopy(body); changed["steps"][0][field] = value
        await save(client, changed, expected=422)
    changed = deepcopy(body); changed["ended_at"] = changed["started_at"]
    await save(client, changed, expected=422)


async def test_settings_changes_do_not_rewrite_started_session_choice(workout_api):
    client, *_ = workout_api
    await client.put("/v1/settings/workouts", json={"auto_log": True, "sound": True})
    assert not (await save(client, payload(False)))["diary_added"]
    await client.put("/v1/settings/workouts", json={"auto_log": False, "sound": True})
    assert (await save(client, payload(True)))["diary_added"]


async def test_history_pagination(workout_api):
    client, *_ = workout_api
    for _ in range(3):
        await save(client)
    first = (await client.get("/v1/workouts/history?limit=2")).json()
    second = (await client.get(f'/v1/workouts/history?limit=2&offset={first["next_offset"]}')).json()
    assert len(first["items"]) == 2 and len(second["items"]) == 1 and second["next_offset"] is None
    assert len({r["id"] for r in first["items"] + second["items"]}) == 3


def test_energy_excludes_rest_and_uses_seconds_not_total_wall_duration():
    assert active_kcal(1, [{"exercise_id": "squat", "active_seconds": 60, "rest_seconds": 900}], 80) == 2.8
    assert active_kcal(1, [{"exercise_id": "squat", "active_seconds": 0}], 80) == 0
    assert {e["animation"] for e in EXERCISES} == {"march", "side_step", "shoulders", "arm_raise", "squat", "wall_push", "calf_raise", "leg_side", "chest", "side_bend", "calf_stretch"}


def test_migration_upgrade_and_downgrade_preserve_diary_tombstone():
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, inspect, text

    spec = importlib.util.spec_from_file_location("workout_migration", Path(__file__).parents[1] / "migrations/versions/024_workouts.py")
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("PRAGMA foreign_keys=ON"))
        conn.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        conn.execute(text("CREATE TABLE day_entries (id INTEGER PRIMARY KEY)"))
        migration.op = Operations(MigrationContext.configure(conn))
        migration.upgrade()
        conn.execute(text("INSERT INTO users (id) VALUES (1)"))
        conn.execute(text("INSERT INTO day_entries (id) VALUES (2)"))
        conn.execute(text("INSERT INTO workout_preferences (user_id) VALUES (1)"))
        assert conn.execute(text("SELECT auto_log, sound FROM workout_preferences")).one() == (0, 1)
        conn.execute(text("""INSERT INTO workout_sessions
            (user_id,id,payload_hash,workout_id,catalogue_version,title,status,started_at,ended_at,
             local_date,timezone,active_seconds,rest_seconds,steps,auto_log,diary_added,diary_entry_id)
            VALUES (1,'session','hash','morning',1,'Test','completed','2026-10-01','2026-10-01',
                    '2026-10-01','UTC',30,0,'[]',1,1,2)"""))
        conn.execute(text("DELETE FROM day_entries WHERE id=2"))
        assert conn.execute(text("SELECT diary_added, diary_entry_id FROM workout_sessions")).one() == (1, None)
        conn.execute(text("DELETE FROM users WHERE id=1"))
        assert conn.execute(text("SELECT count(*) FROM workout_sessions")).scalar() == 0
        migration.downgrade()
        assert "workout_sessions" not in inspect(conn).get_table_names()
        assert "workout_preferences" not in inspect(conn).get_table_names()
    engine.dispose()
