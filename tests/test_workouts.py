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
from src.shared.workouts import EXERCISES, WORKOUTS, FULL_BODY_WORKOUT, catalogue, active_kcal


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
    assert (await client.get("/v1/settings/workouts")).json() == {"auto_log": False, "sound": True, "activity_level": "medium"}
    response = await client.put("/v1/settings/workouts", json={"auto_log": True, "sound": False})
    assert response.json() == (await client.get("/v1/settings/workouts")).json()


async def test_reference_catalogue_negotiation_and_v1_history_remain_compatible(workout_api):
    client, *_ = workout_api
    old = (await client.get("/v1/workouts/catalogue")).json()
    new = (await client.get("/v1/workouts/catalogue?max_version=2")).json()
    assert old == catalogue(1) and new == catalogue(2)
    assert (await client.get("/v1/workouts/catalogue?max_version=999")).json() == catalogue(4)
    assert (await client.get("/v1/workouts/catalogue?max_version=0")).status_code == 422
    reference = next(w for w in new["workouts"] if w["id"] == "body_short")
    assert [s["exercise_id"] for s in reference["steps"]] == [
        "standing_knee_elbow", "sumo_squat", "squat_kick", "incline_pushup", "chair_dip", "prone_pull",
        "plank_pike", "seated_knee_tuck", "crunch_reach", "hands_behind", "quad_right", "quad_left",
    ]
    assert all(s["duration_seconds"] == 30 and s["repetitions"] is None for s in reference["steps"])
    assert sum(s["expected_seconds"] for s in reference["steps"]) == 360
    assert reference["duration_seconds"] == 690
    # A queued v1 result still resolves the old routine, even after v2 was fetched.
    assert (await save(client))["catalogue_version"] == 1


async def test_reference_session_saved_once_with_correct_step_titles_and_calories(workout_api):
    client, factory, *_ = workout_api
    body = payload(True)
    body.update(workout_id="body_short", catalogue_version=2,
                ended_at=(datetime.fromisoformat(body["started_at"]) + timedelta(seconds=690)).isoformat(),
                steps=[dict(step_id=s["id"], active_seconds=30, rest_seconds=s["rest_seconds"], completed=True)
                       for s in FULL_BODY_WORKOUT["steps"]])
    session_id = str(uuid4())
    first = await save(client, body, session_id)
    again = await save(client, body, session_id)
    assert first["id"] == again["id"] and first["diary_entry_id"] == again["diary_entry_id"]
    assert first["steps"] == again["steps"] and first["calories"] == again["calories"]
    assert first["active_seconds"] == 360 and first["rest_seconds"] == 330 and first["completed_steps"] == 12
    assert first["steps"][0]["exercise_title"] == "Колени к локтям стоя"
    assert first["calories"] == active_kcal(2, [dict(exercise_id=s["exercise_id"], active_seconds=30) for s in FULL_BODY_WORKOUT["steps"]], 80)
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(DayEntry)) == 1


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
    await client.put("/v1/settings/workouts", json={"auto_log": False, "sound": True, "activity_level": "medium"})
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


def course_workout(day, level="medium", version=3):
    data = catalogue(version)
    wid = data["course"]["days"][day - 1]["workout_ids"][level]
    return next(w for w in data["workouts"] if w["id"] == wid)


def course_payload(day, level="medium", start=None, version=3):
    definition = course_workout(day, level, version)
    start = start or datetime.now(timezone.utc) - timedelta(days=40-day)
    return dict(workout_id=definition["id"], catalogue_version=version, status="completed",
        started_at=start.isoformat(), ended_at=(start + timedelta(seconds=definition["duration_seconds"])).isoformat(),
        timezone="UTC", auto_log=False, steps=[dict(step_id=s["id"], active_seconds=s["expected_seconds"],
            rest_seconds=s["rest_seconds"], completed=True) for s in definition["steps"]])


def test_course_calendar_levels_and_benchmark():
    data = catalogue(3)
    assert len(data["course"]["days"]) == 28
    assert len([w for w in data["workouts"] if w.get("course_id")]) == 48
    for week in range(4):
        days = data["course"]["days"][week*7:(week+1)*7]
        assert [d["kind"] for d in days] == ["strength", "walk", "strength", "mobility", "strength", "walk", "rest"]
    for day in data["course"]["days"]:
        if not day["workout_ids"]:
            continue
        versions = [course_workout(day["day"], level) for level in ("light", "medium", "intense")]
        for w in versions:
            assert w["duration_seconds"] == sum(s["duration_seconds"] + s["rest_seconds"] for s in w["steps"])
            assert len(w["steps"]) < 100
        baseline = [(s["exercise_id"], s["section"], s["rest_seconds"], s["optional"]) for s in versions[0]["steps"]]
        for w in versions[1:]:
            assert [(s["exercise_id"], s["section"], s["rest_seconds"], s["optional"]) for s in w["steps"]] == baseline
        for steps in zip(*(w["steps"] for w in versions)):
            times = [s["duration_seconds"] for s in steps]
            assert times[1]-times[0] == (10 if steps[0]["section"] == "main" else 0)
            assert times[2]-times[1] == (10 if steps[0]["section"] == "main" else 0)
    for level in ("light", "medium", "intense"):
        one, final = course_workout(1, level), course_workout(26, level)
        assert [dict(s, id="") for s in one["steps"]] == [dict(s, id="") for s in final["steps"]]
        assert any(s["exercise_id"] == "chair_dip" for s in one["steps"])
    assert not any(s["exercise_id"] in ("glute_bridge", "bird_dog") for s in course_workout(5)["steps"])
    assert any(s["exercise_id"] == "glute_bridge" for s in course_workout(8)["steps"])
    assert any(s["exercise_id"] == "bird_dog" for s in course_workout(15)["steps"])


def test_revised_course_is_shorter_uses_repetitions_and_preserves_published_catalogues():
    import hashlib
    import json
    hashes = {
        1: "a6bc7fa7f5a74c83eeeff012f2889ec8f8ae12a6bceb3c2367797fb10602b36d",
        2: "b3a5824d69d68a5189e14e9843c0e36153c25511475fd62f45408b88c564d94c",
        3: "d55d9886b6ede645d804191b9de72426076ca0d5b120ada6b77a7937f7654ed9",
    }
    for version, digest in hashes.items():
        assert hashlib.sha256(json.dumps(catalogue(version), sort_keys=True, ensure_ascii=False).encode()).hexdigest() == digest
    data = catalogue(4)
    assert data["course"]["id"] == catalogue(3)["course"]["id"]
    assert data["course"]["revision"] == 2
    assert [day["kind"] for day in data["course"]["days"]] == [day["kind"] for day in catalogue(3)["course"]["days"]]
    assert [d["walk_minutes"] for d in data["course"]["days"] if d["kind"] == "walk"] == [15, 15, 20, 20, 25, 25, 30, 30]
    old_workouts = {w["id"]: w for w in catalogue(3)["workouts"]}
    for w in data["workouts"]:
        if w["id"] in old_workouts:
            assert w == old_workouts[w["id"]]
    exercises = {ex["id"]: ex for ex in data["exercises"]}
    forbidden = {"chair_dip", "plank_pike", "seated_knee_tuck", "squat_kick"}
    for day in data["course"]["days"]:
        if not day["workout_ids"]:
            continue
        for level, reps in (("light", 6), ("medium", 8), ("intense", 10)):
            w = course_workout(day["day"], level, 4)
            assert w["id"] not in old_workouts
            assert not forbidden.intersection(s["exercise_id"] for s in w["steps"])
            assert all(15 <= s["rest_seconds"] <= 30 for s in w["steps"])
            assert w["duration_seconds"] == sum(s["expected_seconds"] + s["rest_seconds"] for s in w["steps"])
            if day["kind"] == "strength":
                main = [s for s in w["steps"] if s["section"] == "main"]
                assert 5 <= len(main) <= 6
                assert len(w["steps"]) <= 11
                assert all(s["duration_seconds"] is None and s["repetitions"] == reps for s in main)
                assert all(exercises[s["exercise_id"]]["easier"] for s in main)
                assert any(s["exercise_id"] == "glute_bridge" for s in main)
                assert sum(s["expected_seconds"] for s in w["steps"] if s["section"] == "warmup") == 300
                assert sum(s["expected_seconds"] for s in w["steps"] if s["section"] == "cooldown") == 300
            else:
                assert len(w["steps"]) == 6
                assert w["duration_seconds"] + 15 == 375
    for level in ("light", "medium", "intense"):
        one, last = course_workout(1, level, 4), course_workout(26, level, 4)
        assert [dict(s, id="") for s in one["steps"]] == [dict(s, id="") for s in last["steps"]]
    assert any(s["exercise_id"] == "quadruped_leg" for s in course_workout(8, "medium", 4)["steps"])
    assert any(s["exercise_id"] == "bird_dog" for s in course_workout(8, "intense", 4)["steps"])


async def test_upgrade_keeps_completed_days_and_accepts_old_queued_sessions(workout_api):
    client, *_ = workout_api
    assert (await client.get("/v1/workouts/catalogue?max_version=3")).json() == catalogue(3)
    assert (await client.get("/v1/workouts/catalogue?max_version=4")).json() == catalogue(4)
    first = await save(client, course_payload(1))
    assert first["course_progress"][0]["day"] == 1
    check = dict(course_id="full_body_28_v1", completed_at=(datetime.now(timezone.utc) - timedelta(days=38)).isoformat(), timezone="UTC")
    assert (await client.put("/v1/workouts/course/days/2", json=check)).status_code == 200
    third = await save(client, course_payload(3, version=4))
    assert [p["day"] for p in third["course_progress"]] == [1, 2, 3]
    assert third["catalogue_version"] == 4
    history = (await client.get("/v1/workouts/history")).json()["items"]
    assert {item["catalogue_version"] for item in history} == {3, 4}


async def test_revised_course_rejects_skipped_main_step_and_preserves_rest_calculation(workout_api):
    client, *_ = workout_api
    body = course_payload(1, version=4)
    main = next(i for i, step in enumerate(course_workout(1, version=4)["steps"]) if step["section"] == "main")
    body["steps"][main]["completed"] = False
    await save(client, body, expected=422)
    body["status"] = "interrupted"
    saved = await save(client, body)
    assert saved["course_progress"] == []
    assert saved["rest_seconds"] == sum(step["rest_seconds"] for step in body["steps"])


@pytest.mark.parametrize("version", [3, 4])
async def test_course_all_28_days_idempotent_progress_and_account_isolation(workout_api, version):
    client, factory, owner, other = workout_api
    for day in catalogue(version)["course"]["days"]:
        number = day["day"]
        if day["workout_ids"]:
            body, id = course_payload(number, "light" if number < 15 else "intense", version=version), str(uuid4())
            await save(client, body, id)
            await save(client, body, id)
        else:
            body = dict(course_id="full_body_28_v1", completed_at=(datetime.now(timezone.utc)-timedelta(days=40-number)).isoformat(), timezone="UTC")
            for _ in range(2):
                response = await client.put(f"/v1/workouts/course/days/{number}", json=body)
                assert response.status_code == 200, response.text
        progress = (await client.get("/v1/workouts/course/progress")).json()
        assert [p["day"] for p in progress] == list(range(1, number+1))
    headers = {"Authorization": f"Bearer {issue_access_token(other)}"}
    assert (await client.get("/v1/workouts/course/progress", headers=headers)).json() == []
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(DayEntry)) == 0
    assert (await client.delete("/v1/account")).status_code == 204
    from src.db.models import WorkoutCourseDay
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(WorkoutCourseDay)) == 0


async def test_course_rest_gates_and_partial_sessions(workout_api):
    client, *_ = workout_api
    check = dict(course_id="full_body_28_v1", completed_at=datetime.now(timezone.utc).isoformat(), timezone="UTC")
    assert (await client.put("/v1/workouts/course/days/2", json=check)).status_code == 409
    assert (await client.put("/v1/workouts/course/days/1", json=check)).status_code == 422
    body = course_payload(1, start=datetime.now(timezone.utc)-timedelta(hours=1))
    main = next(i for i,s in enumerate(course_workout(1)["steps"]) if s["section"] == "main")
    body["steps"][main].update(completed=False, active_seconds=0)
    await save(client, body, expected=422)
    body["status"] = "interrupted"
    await save(client, body)
    assert (await client.get("/v1/workouts/course/progress")).json() == []
    await save(client, course_payload(1, start=datetime.now(timezone.utc)-timedelta(hours=1)))
    assert (await client.put("/v1/workouts/course/days/2", json=check)).status_code == 409
    # A completed session remains in history even if another device has an incompatible course date.
    await save(client, course_payload(3, start=datetime.now(timezone.utc)-timedelta(hours=1)))
    assert len((await client.get("/v1/workouts/course/progress")).json()) == 1


async def test_course_duration_validation_and_legacy_settings_client(workout_api):
    client, *_ = workout_api
    body = course_payload(1, "intense")
    main = next(i for i,s in enumerate(course_workout(1, "intense")["steps"]) if s["section"] == "main")
    body["steps"][main]["active_seconds"] = 20
    await save(client, body, expected=422)
    assert (await client.put("/v1/settings/workouts", json={"auto_log": False, "sound": True, "activity_level": "intense"})).status_code == 200
    await client.put("/v1/settings/workouts", json={"auto_log": True, "sound": False})
    assert (await client.get("/v1/settings/workouts")).json()["activity_level"] == "intense"
    assert (await client.put("/v1/settings/workouts", json={"activity_level": "extreme"})).status_code == 422


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


def test_course_migration_preserves_preferences_and_cascades_account_deletion():
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, inspect, text

    spec = importlib.util.spec_from_file_location("course_migration", Path(__file__).parents[1] / "migrations/versions/026_workout_course.py")
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("PRAGMA foreign_keys=ON"))
        conn.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        conn.execute(text("CREATE TABLE workout_preferences (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, auto_log BOOLEAN NOT NULL, sound BOOLEAN NOT NULL)"))
        conn.execute(text("INSERT INTO users VALUES (1), (2)"))
        conn.execute(text("INSERT INTO workout_preferences VALUES (1, 1, 0), (2, 0, 1)"))
        migration.op = Operations(MigrationContext.configure(conn))
        migration.upgrade()
        assert conn.execute(text("SELECT user_id, auto_log, sound, activity_level FROM workout_preferences ORDER BY user_id")).all() == [(1, 1, 0, "medium"), (2, 0, 1, "medium")]
        conn.execute(text("INSERT INTO workout_course_days (user_id, course_id, day, completed_at, local_date) VALUES (1, 'full_body_28_v1', 1, '2026-11-01', '2026-11-01')"))
        conn.execute(text("DELETE FROM users WHERE id=1"))
        assert conn.execute(text("SELECT count(*) FROM workout_course_days")).scalar() == 0
        migration.downgrade()
        assert "workout_course_days" not in inspect(conn).get_table_names()
        assert conn.execute(text("SELECT * FROM workout_preferences")).all() == [(2, 0, 1)]
    engine.dispose()
