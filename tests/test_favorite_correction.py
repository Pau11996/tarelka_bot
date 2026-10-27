from datetime import date, timedelta
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import func, select

from test_mobile_api import api, _login
from test_mobile_experience import setup
from src.db.models import DayEntry, EntryType, MobileMedia, MobileOperation, User
from src.db.repository import UserRepository
from src.mobile_api import analysis, worker
from src.shared.schemas import AnalysisResult, NutrientItem


async def seed(setup, kind="meal"):
    client, factory, headers, uid = setup
    async with factory() as session:
        repo = UserRepository(session)
        await repo.ensure_default_profile(uid)
        entry = await repo.create_entry(
            user_id=uid, entry_date=date.today() - timedelta(days=2),
            entry_type=EntryType(kind), title="Сохранённая порция", calories=300,
            protein_g=12, fat_g=10, carbs_g=40,
            volume_ml=250 if kind == "water" else None,
            duration_minutes=30 if kind == "activity" else None,
            items=[{"name": "Каша", "quantity": "250 г", "calories": 300}],
            micronutrients={"fiber_g": 4},
        )
        favorite = await repo.create_favorite_from_entry(entry)
        return favorite.id, entry.id


def result_for(kind="meal", calories=360):
    return AnalysisResult(
        type=kind, title="Обновлённая порция", total_calories=calories,
        protein_g=14, fat_g=12, carbs_g=48, micronutrients={"fiber_g": 5},
        items=[NutrientItem(name="Каша", quantity="300 г", calories=calories)],
        volume_ml=500 if kind == "water" else None,
        duration_minutes=45 if kind == "activity" else None,
    )


def fake_ai(monkeypatch, result=None):
    ai = AsyncMock()
    ai.analyze_text.return_value = ("{}", result or result_for())
    monkeypatch.setattr(analysis, "AIAnalyzerClient", lambda: ai)
    return ai


@pytest.mark.parametrize("kind", ["meal", "water", "activity"])
async def test_correction_changes_template_only_and_future_logs_use_it(setup, monkeypatch, kind):
    client, factory, headers, uid = setup
    fid, eid = await seed(setup, kind)
    path = f"/v1/favorites/{fid}"
    old_log = (await client.post(path + "/log", headers=headers)).json()["entry"]
    before = (await client.get(f"/v1/entries/{eid}", headers=headers)).json()
    ai = fake_ai(monkeypatch, result_for(kind))
    data = {"request_key": "favorite-correction-1", "text": "Порция 300 г"}
    response = await client.post(path + "/correct", headers=headers, json=data)
    assert response.status_code == 202
    op = response.json()
    assert op["kind"] == "correct_favorite"
    assert (await client.get(path, headers=headers)).json()["operation"]["id"] == op["id"]
    assert (await client.post(path + "/log", headers=headers)).status_code == 409
    replay = await client.post(path + "/correct", headers=headers, json=data)
    assert replay.json()["id"] == op["id"]
    assert (await client.post(path + "/correct", headers=headers, json={**data, "request_key": "another-key"})).status_code == 409
    assert not (await client.get("/v1/chat", headers=headers)).json()["operations"]
    assert await worker.process_one()
    detail = (await client.get(path, headers=headers)).json()
    assert detail["operation"]["status"] == "done"
    assert detail["operation"]["result"]["status"] == "saved"
    favorite = detail["favorite"]
    assert favorite["source_entry_id"] == eid
    assert favorite["id"] == fid
    assert favorite["title"] == "Обновлённая порция"
    assert favorite["calories"] == (0 if kind == "water" else 360)
    assert favorite["protein_g"] == (14 if kind == "meal" else 0)
    assert favorite["volume_ml"] == (500 if kind == "water" else None)
    assert favorite["duration_minutes"] == (45 if kind == "activity" else None)
    assert ai.analyze_text.call_args.kwargs["mode"] == kind
    previous = ai.analyze_text.call_args.kwargs["previous_result"]
    assert previous["title"] == "Сохранённая порция"
    assert previous["items"][0]["quantity"] == "250 г"
    assert (await client.get(f"/v1/entries/{eid}", headers=headers)).json() == before
    old_again = (await client.get(f"/v1/entries/{old_log['id']}", headers=headers)).json()
    for key in ("title", "calories", "volume_ml", "duration_minutes", "items"):
        assert old_again[key] == old_log[key]
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(DayEntry)) == 2
    new_log = (await client.post(path + "/log", headers=headers)).json()["entry"]
    for key in ("title", "calories", "protein_g", "volume_ml", "duration_minutes", "items"):
        assert new_log[key] == favorite[key]
    assert (await client.post(path + "/correct", headers=headers, json=data)).json()["status"] == "done"
    assert not await worker.process_one()
    ai.analyze_text.assert_awaited_once()
    assert not (await client.get("/v1/chat", headers=headers)).json()["operations"]
    # Next correction receives the current saved portion, never the source entry.
    await client.post(path + "/correct", headers=headers, json={**data, "request_key": "favorite-correction-2"})
    await worker.process_one()
    assert ai.analyze_text.call_args.kwargs["previous_result"]["title"] == favorite["title"]


async def test_failure_rolls_back_template_and_reuses_operation_on_retry(setup, monkeypatch):
    client, factory, headers, uid = setup
    fid, _ = await seed(setup)
    path = f"/v1/favorites/{fid}"
    before = (await client.get(path, headers=headers)).json()["favorite"]
    ai = fake_ai(monkeypatch)
    original = analysis.AnalysisService.correct_favorite

    async def interrupted(self, user, favorite_id, text):
        await original(self, user, favorite_id, text)
        raise RuntimeError("Lost worker before atomic commit")

    monkeypatch.setattr(analysis.AnalysisService, "correct_favorite", interrupted)
    data = {"request_key": "favorite-rollback", "text": "Увеличить порцию"}
    op = (await client.post(path + "/correct", headers=headers, json=data)).json()
    await worker.process_one()
    detail = (await client.get(path, headers=headers)).json()
    assert detail["favorite"] == before
    assert detail["operation"]["status"] == "failed"
    monkeypatch.setattr(analysis.AnalysisService, "correct_favorite", original)
    retried = (await client.post(path + "/correct", headers=headers, json=data)).json()
    assert retried["id"] == op["id"]
    assert retried["status"] == "queued"
    await worker.process_one()
    assert (await client.get(path, headers=headers)).json()["favorite"]["calories"] == 360
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(DayEntry)) == 1


@pytest.mark.parametrize("failure", ["unknown", "wrong_type", "network", "limit"])
async def test_unsuccessful_correction_keeps_favorite_and_diary(setup, monkeypatch, failure):
    client, factory, headers, uid = setup
    fid, _ = await seed(setup)
    path = f"/v1/favorites/{fid}"
    before = (await client.get(path, headers=headers)).json()["favorite"]
    ai = fake_ai(monkeypatch)
    if failure == "network":
        ai.analyze_text.side_effect = httpx.ConnectError("offline")
    elif failure == "limit":
        monkeypatch.setattr(analysis, "consume_request_grant", AsyncMock(return_value=None))
    else:
        ai.analyze_text.return_value = ("{}", AnalysisResult(type="unknown" if failure == "unknown" else "activity"))
    await client.post(path + "/correct", headers=headers, json={"request_key": "favorite-failed", "text": "Уточнение"})
    await worker.process_one()
    detail = (await client.get(path, headers=headers)).json()
    assert detail["favorite"] == before
    operation = detail["operation"]
    if failure in ("unknown", "wrong_type"):
        assert operation["result"]["status"] == "unknown"
    else:
        assert operation["status"] == "failed"
    if failure == "limit":
        assert operation["limit_reached"]["code"] == "daily_limit_reached"
        ai.analyze_text.assert_not_awaited()


async def test_favorite_ownership_validation_and_superseded_retry(setup, monkeypatch):
    client, factory, headers, uid = setup
    fid, eid = await seed(setup)
    path = f"/v1/favorites/{fid}"
    token, _ = await _login(client, factory, 9123)
    other = {"Authorization": f"Bearer {token}"}
    data = {"request_key": "private-favorite", "text": "300 г"}
    assert (await client.get(path, headers=other)).status_code == 404
    assert (await client.post(path + "/correct", headers=other, json=data)).status_code == 404
    assert (await client.post(path + "/correct", headers=headers, json={**data, "text": "   "})).status_code == 422
    ai = fake_ai(monkeypatch)
    ai.analyze_text.side_effect = httpx.ConnectError("offline")
    old = (await client.post(path + "/correct", headers=headers, json=data)).json()
    await worker.process_one()
    assert (await client.post(path + "/correct", headers=headers, json={**data, "text": "400 г"})).status_code == 409
    ai.analyze_text.side_effect = None
    await client.post(path + "/correct", headers=headers, json={**data, "request_key": "new-favorite-edit"})
    await worker.process_one()
    assert (await client.post(path + "/correct", headers=headers, json=data)).status_code == 409
    assert (await client.post(f"/v1/operations/{old['id']}/retry", headers=headers)).status_code == 409
    assert (await client.post("/v1/operations", headers=headers, data=data)).status_code == 409
    # The saved template also works when its original diary entry is gone.
    async with factory() as session:
        favorite = await UserRepository(session).get_favorite(fid, uid)
        favorite.source_entry_id = None
        await session.delete(await session.get(DayEntry, eid))
        await session.commit()
    assert (await client.get(path, headers=headers)).status_code == 200
    await client.post(path + "/correct", headers=headers, json={**data, "request_key": "orphan-favorite-edit"})
    await worker.process_one()
    assert (await client.get(path, headers=headers)).json()["operation"]["status"] == "done"
    # Removing the template before a queued job starts cannot recreate it.
    await client.post(path + "/correct", headers=headers, json={**data, "request_key": "deleted-favorite-edit"})
    await client.delete(path, headers=headers)
    await worker.process_one()
    assert (await client.get(path, headers=headers)).status_code == 404


async def test_details_keep_source_photos_without_redirecting_to_entry(setup):
    client, factory, headers, uid = setup
    fid, eid = await seed(setup)
    async with factory() as session:
        session.add(MobileOperation(id="photo-op", user_id=uid, request_key="photo-op-key", kind="analyze", status="done", payload={}, entry_id=eid))
        await session.flush()
        session.add(MobileMedia(id="photo", user_id=uid, operation_id="photo-op", mime="image/jpeg", size=20))
        await session.commit()
    detail = (await client.get(f"/v1/favorites/{fid}", headers=headers)).json()
    assert detail["favorite"]["id"] == fid
    assert detail["favorite"]["media"] == [{"id": "photo", "mime": "image/jpeg", "url": "/v1/media/photo"}]
