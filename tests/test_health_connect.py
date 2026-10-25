from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from src.db.models import Base, DayEntry, HealthRecord, Profile, User, WeightHistory
from src.db.repository import UserRepository
from src.db.session import get_session
from src.mobile_api.health import utc_bounds
from src.mobile_api.main import app
from src.mobile_api.tokens import issue_access_token

TYPES = ["Steps", "Distance", "ActiveCaloriesBurned", "ExerciseSession", "Weight"]
ORIGIN = "com.sec.android.app.shealth"


@pytest.fixture
async def health_api(monkeypatch):
    monkeypatch.setenv("HEALTH_CONNECT_ENABLED", "1")
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async def sessions():
        async with factory() as session:
            yield session
    app.dependency_overrides[get_session] = sessions
    async with factory() as session:
        repo = UserRepository(session)
        user = await repo.get_or_create_user(-120001, "Europe/Minsk")
        owner = user.id
        await repo.upsert_profile(owner, weight_kg=80, daily_calorie_target=2100)
        other = await repo.get_or_create_user(-120002, "UTC")
        other_id = other.id
    headers = {"Authorization": f"Bearer {issue_access_token(owner)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=headers) as client:
        yield client, factory, owner, other_id
    app.dependency_overrides.clear()
    await engine.dispose()


async def connect(client, **kwargs):
    body = {"installation_id": str(uuid4()), "permissions": TYPES, "workout_origin": ORIGIN, **kwargs}
    response = await client.put("/v1/health/connection", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def batch(config, **kwargs):
    day = config["windows"][-1]
    start = datetime.fromisoformat(day["start_at"]) + timedelta(hours=12)
    return {
        "connection_id": config["connection_id"], "generation": config["generation"],
        "batch_id": str(uuid4()), "base_revision": config["revision"], "timezone": config["timezone"],
        "start_date": day["date"], "end_date": day["date"], "types": config["permissions"],
        "days": [{"date": day["date"], "steps": 6500, "distance_m": 4000, "active_kcal": 350, "exercise_minutes": 30, "origins": [ORIGIN]}],
        "records": [
            {"record_type": "Weight", "external_id": "weight-1", "origin": ORIGIN, "start_at": start.isoformat(), "weight_kg": 75},
            {"record_type": "ExerciseSession", "external_id": "workout-1", "origin": ORIGIN, "start_at": start.isoformat(), "end_at": (start + timedelta(minutes=30)).isoformat(), "duration_minutes": 30, "title": "Прогулка"},
        ], "deleted": [], "reconcile": True, **kwargs,
    }


async def send(client, payload, code=200):
    response = await client.post("/v1/health/sync", json=payload)
    assert response.status_code == code, response.text
    return response.json()


async def test_import_is_display_only_and_keeps_manual_data(health_api):
    client, factory, owner, _ = health_api
    config = await connect(client)
    path = f'/v1/days/{config["today"]}'
    before = (await client.get(path)).json()
    await send(client, batch(config))
    after = (await client.get(path)).json()
    assert before["balance"] == after["balance"]
    assert before["entry_dates"] == after["entry_dates"] == []
    assert after["entries"] == []
    assert after["health"]["contributes_to_budget"] is False
    assert after["health"]["days"][0]["steps"] == 6500
    assert len(after["health"]["workouts"]) == 1
    stats = (await client.get("/v1/stats?days=7")).json()
    assert stats["health"]["days"][-1]["active_kcal"] == 350
    assert {w["source"] for w in stats["weight"]} == {"manual", "health_connect"}
    async with factory() as session:
        assert (await session.scalar(select(Profile).where(Profile.user_id == owner))).weight_kg == 80
        assert await session.scalar(select(func.count()).select_from(WeightHistory)) == 1
        assert await session.scalar(select(func.count()).select_from(DayEntry)) == 0


async def test_retries_are_idempotent_and_stale_batches_conflict(health_api):
    client, factory, _, _ = health_api
    config = await connect(client)
    payload = batch(config)
    result = await send(client, payload)
    assert await send(client, payload) == result
    conflict = deepcopy(payload); conflict["days"][0]["steps"] = 1
    await send(client, conflict, 409)
    stale = deepcopy(payload); stale["batch_id"] = str(uuid4())
    await send(client, stale, 409)
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(HealthRecord)) == 2


async def test_updates_deletes_and_reconciliation_do_not_leave_duplicates(health_api):
    client, factory, _, _ = health_api
    config = await connect(client)
    payload = batch(config)
    await send(client, payload)
    config = (await client.get("/v1/health/connection")).json()
    update = batch(config, reconcile=False)
    update["records"] = [update["records"][0]]
    update["records"][0]["weight_kg"] = 74
    update["deleted"] = [{"record_type": "ExerciseSession", "external_id": "workout-1"}]
    await send(client, update)
    async with factory() as session:
        records = (await session.scalars(select(HealthRecord))).all()
        assert len(records) == 1 and records[0].values["weight_kg"] == 74
    config = (await client.get("/v1/health/connection")).json()
    clear = batch(config, records=[])
    clear["days"][0].update(steps=0, distance_m=None, active_kcal=0, exercise_minutes=None)
    await send(client, clear)
    day = (await client.get(f'/v1/days/{config["today"]}')).json()["health"]["days"][0]
    assert day["steps"] == 0 and day["distance_m"] is None
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(HealthRecord)) == 0


async def test_device_replacement_and_account_boundaries(health_api):
    client, _, _, other = health_api
    config = await connect(client)
    payload = batch(config)
    await send(client, payload)
    new_phone = str(uuid4())
    denied = await client.put("/v1/health/connection", json={"installation_id": new_phone, "permissions": TYPES})
    assert denied.status_code == 409
    new = await connect(client, installation_id=new_phone, replace_existing=True)
    assert new["generation"] != config["generation"]
    await send(client, payload, 409)
    assert new["last_synced_at"]
    other_headers = {"Authorization": f"Bearer {issue_access_token(other)}"}
    assert (await client.get("/v1/health/connection", headers=other_headers)).json()["connection_id"] is None
    assert (await client.post("/v1/health/sync", json=batch(new), headers=other_headers)).status_code == 409
    assert (await client.get("/v1/stats?days=7", headers=other_headers)).json()["health"] is None


async def test_disconnect_keeps_history_and_purge_preserves_manual_weight(health_api):
    client, factory, _, _ = health_api
    config = await connect(client)
    payload = batch(config)
    await send(client, payload)
    assert (await client.delete("/v1/health/connection")).status_code == 204
    day = (await client.get(f'/v1/days/{config["today"]}')).json()
    assert day["health"]["connected"] is False
    assert day["health"]["days"][0]["steps"] == 6500
    await send(client, payload, 409)
    assert (await client.delete("/v1/health/data")).status_code == 204
    assert (await client.get("/v1/health/connection")).json()["last_synced_at"] is None
    weights = (await client.get("/v1/weight")).json()["weight"]
    assert len(weights) == 1 and weights[0]["source"] == "manual"
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(HealthRecord)) == 0


async def test_revoked_permissions_and_timezone_do_not_zero_other_metrics(health_api):
    client, factory, owner, _ = health_api
    config = await connect(client)
    await send(client, batch(config))
    partial = await connect(client, installation_id=config["installation_id"], permissions=["Steps"])
    await send(client, batch(partial, records=[], types=["Steps"], days=[{"date": partial["today"], "steps": 1}]))
    day = (await client.get(f'/v1/days/{config["today"]}')).json()["health"]["days"][0]
    assert day["steps"] == 1 and day["active_kcal"] == 350
    await send(client, batch(partial, records=[]), 409)  # already consumed revision
    async with factory() as session:
        user = await session.get(User, owner); user.timezone = "Europe/Berlin"; await session.commit()
    stale = batch(partial, records=[]); stale["base_revision"] = 2
    await send(client, stale, 409)
    day = (await client.get(f'/v1/days/{config["today"]}')).json()["health"]["days"][0]
    assert day["steps"] is None


async def test_flag_off_and_input_validation(health_api, monkeypatch):
    client, _, _, _ = health_api
    config = await connect(client)
    bad = batch(config); bad["days"][0]["steps"] = -1
    await send(client, bad, 422)
    bad = batch(config); bad["records"][1]["origin"] = "another.app"
    await send(client, bad, 422)
    bad = batch(config, days=[])
    await send(client, bad, 422)
    bad = batch(config); bad["days"][0]["extra"] = 100
    await send(client, bad, 422)
    monkeypatch.setenv("HEALTH_CONNECT_ENABLED", "0")
    assert (await client.get("/v1/health/connection")).json()["available"] is False
    await send(client, batch(config), 503)


@pytest.mark.parametrize(("day", "hours"), [(date(2026, 3, 29), 23), (date(2026, 10, 25), 25)])
def test_server_day_windows_follow_dst(day, hours):
    start, end = utc_bounds(day, ZoneInfo("Europe/Berlin"))
    assert (end - start).total_seconds() == hours * 3600


async def test_regrant_invalidates_stale_outbox_and_account_delete_removes_imports(health_api):
    from src.db.models import HealthConnection, HealthDailySummary, HealthSyncReceipt
    client, factory, owner, _ = health_api
    config = await connect(client)
    payload = batch(config)
    await send(client, payload)
    partial = await connect(client, installation_id=config["installation_id"], permissions=["Steps"])
    assert partial["generation"] != config["generation"]
    await send(client, payload, 409)
    async with factory() as session:
        user = await session.get(User, owner)
        await UserRepository(session).delete_user(user)
        for model in (HealthConnection, HealthDailySummary, HealthRecord, HealthSyncReceipt):
            assert await session.scalar(select(func.count()).select_from(model)) == 0


async def test_reconnect_updates_and_deletes_known_records_across_generations(health_api):
    client, factory, _, _ = health_api
    config = await connect(client)
    await send(client, batch(config))
    config = await connect(client, permissions=["Weight"], replace_existing=True)
    update = batch(config, reconcile=False)
    update["records"] = [update["records"][0]]
    update["records"][0]["weight_kg"] = 74
    await send(client, update)
    async with factory() as session:
        rows = (await session.scalars(select(HealthRecord).where(HealthRecord.record_type == "Weight"))).all()
        assert len(rows) == 1 and rows[0].generation == config["generation"] and rows[0].values["weight_kg"] == 74
    config = await connect(client, permissions=["Weight"], replace_existing=True)
    await send(client, batch(config, records=[], reconcile=False, deleted=[{"record_type":"Weight", "external_id":"weight-1"}]))
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(HealthRecord).where(HealthRecord.record_type == "Weight")) == 0
