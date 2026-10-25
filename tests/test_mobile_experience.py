from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock
import pytest
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import async_sessionmaker
from test_mobile_api import api, _login
from src.db.models import (
    MobileOperation,
    MobileMedia,
    PushDevice,
    PushDelivery,
    User,
    EntryType,
    AnalysisType,
    Payment,
)
from src.db.repository import UserRepository
from src.mobile_api import worker, experience
from src.mobile_api.analysis import AnalysisService
from src.mobile_api.statistics import chart_facts
from src.shared.notifications import notify_user
from src.shared.schemas import AnalysisResult


async def test_delayed_analysis_keeps_submission_day(setup):
    _, factory, _, uid = setup
    submitted = date.today() - timedelta(days=1)
    ai = AsyncMock()
    ai.analyze_text.return_value = (
        "{}",
        AnalysisResult(type="meal", title="Поздний ужин", total_calories=450),
    )
    async with factory() as session:
        user = await session.get(User, uid)
        result = await AnalysisService(session, ai).analyze(
            user,
            text="Ужин",
            image=None,
            audio=None,
            entry_date=submitted,
            defer_reward=True,
        )
        assert result["entry"]["entry_date"] == submitted.isoformat()
        repo = UserRepository(session)
        assert len(await repo.get_entries_for_date(uid, submitted)) == 1
        assert not await repo.get_entries_for_date(uid, date.today())


@pytest.fixture
async def setup(api, monkeypatch, tmp_path):
    client, factory = api
    token, uid = await _login(client, factory, 5011)
    monkeypatch.setattr(experience, "MEDIA_ROOT", tmp_path)
    monkeypatch.setattr(worker, "async_session_factory", factory)
    monkeypatch.setattr(
        worker,
        "atomic_factory",
        async_sessionmaker(
            factory.kw["bind"], class_=worker.AtomicSession, expire_on_commit=False
        ),
    )
    monkeypatch.setattr(worker, "_reward_referrer", AsyncMock())
    return client, factory, {"Authorization": f"Bearer {token}"}, uid


async def test_job_survives_request_and_replay_does_not_add_second_entry(
    setup, monkeypatch
):
    client, factory, h, uid = setup
    calls = []

    async def analyze(self, user, **kwargs):
        calls.append(kwargs)
        entry = await self.repo.create_entry(
            user_id=user.id,
            entry_date=date.today(),
            entry_type=EntryType.MEAL,
            title="Обед",
            calories=500,
            protein_g=20,
            fat_g=15,
            carbs_g=60,
        )
        return {"status": "saved", "entry": {"id": entry.id}, "balance": {}}

    monkeypatch.setattr(AnalysisService, "analyze", analyze)
    data = {"request_key": "test-request-001", "text": "Обед"}
    first = await client.post("/v1/operations", headers=h, data=data)
    assert first.status_code == 202
    assert first.json()["status"] == "queued"
    again = await client.post("/v1/operations", headers=h, data=data)
    assert again.json()["id"] == first.json()["id"]
    assert await worker.process_one()
    result = await client.get("/v1/operations/" + first.json()["id"], headers=h)
    assert result.json()["status"] == "done"
    assert len(calls) == 1
    replay = await client.post("/v1/operations", headers=h, data=data)
    assert replay.json()["status"] == "done"
    assert not await worker.process_one()
    history = (await client.get("/v1/chat", headers=h)).json()
    assert history["entries"][0]["title"] == "Обед"
    assert history["operations"][0]["text"] == "Обед"
    from src.shared.activity import count_meal_active_users

    now = datetime.now(timezone.utc)
    async with factory() as session:
        assert await count_meal_active_users(
            session, start_at=now - timedelta(days=1), end_at=now
        ) == 1


async def test_worker_rolls_back_partial_entry_before_retry(setup, monkeypatch):
    client, factory, h, uid = setup

    async def failing(self, user, **kwargs):
        await self.repo.create_entry(
            user_id=user.id,
            entry_date=date.today(),
            entry_type=EntryType.MEAL,
            title="Не сохранять",
            calories=200,
        )
        raise RuntimeError("after repository commit")

    monkeypatch.setattr(AnalysisService, "analyze", failing)
    op = (
        await client.post(
            "/v1/operations",
            headers=h,
            data={"request_key": "rollback-test", "text": "еда"},
        )
    ).json()
    await worker.process_one()
    assert (await client.get("/v1/operations/" + op["id"], headers=h)).json()[
        "status"
    ] == "failed"
    assert not (await client.get("/v1/chat", headers=h)).json()["entries"]
    assert (
        await client.post("/v1/operations/" + op["id"] + "/retry", headers=h)
    ).json()["status"] == "queued"


async def test_media_and_operations_are_private(setup):
    client, factory, h, uid = setup
    op = (
        await client.post(
            "/v1/operations",
            headers=h,
            data={"request_key": "media-request"},
            files={"image": ("food.jpg", b"fake-image", "image/jpeg")},
        )
    ).json()
    history = (await client.get("/v1/chat", headers=h)).json()
    url = history["media"][0]["url"]
    assert (await client.get(url, headers=h)).content == b"fake-image"
    token, _ = await _login(client, factory, 5012)
    other = {"Authorization": f"Bearer {token}"}
    assert (await client.get(url, headers=other)).status_code == 404
    assert (
        await client.get("/v1/operations/" + op["id"], headers=other)
    ).status_code == 404
    assert (
        await client.post("/v1/operations/" + op["id"] + "/retry", headers=other)
    ).status_code == 404
    assert (await client.get(url)).status_code == 401


async def test_uploaded_photo_stays_in_chat_after_analysis_and_reload(setup, monkeypatch):
    client, _, headers, _ = setup
    photo = b"uploaded-photo-bytes"

    async def analyze(self, user, **kwargs):
        assert len(kwargs["image"]) == 1
        assert await kwargs["image"][0].read() == photo
        entry = await self.repo.create_entry(
            user_id=user.id,
            entry_date=date.today(),
            entry_type=EntryType.MEAL,
            title="Обед по фото",
            calories=500,
        )
        return {"status": "saved", "entry": {"id": entry.id}, "balance": {}}

    monkeypatch.setattr(AnalysisService, "analyze", analyze)
    response = await client.post(
        "/v1/operations",
        headers=headers,
        data={"request_key": "photo-survives-analysis"},
        files={"image": ("food.jpg", photo, "image/jpeg")},
    )
    assert response.status_code == 202
    operation_id = response.json()["id"]
    queued = (await client.get("/v1/chat", headers=headers)).json()
    assert len(queued["media"]) == 1
    attachment = queued["media"][0]
    assert attachment["operation_id"] == operation_id

    assert await worker.process_one()
    for _ in range(2):
        history = (await client.get("/v1/chat", headers=headers)).json()
        assert history["media"] == [attachment]
        operation = next(op for op in history["operations"] if op["id"] == operation_id)
        assert operation["status"] == "done"
        assert operation["entry_id"] == history["entries"][0]["id"]
        image = await client.get(attachment["url"], headers=headers)
        assert image.status_code == 200
        assert image.headers["content-type"] == "image/jpeg"
        assert image.content == photo


async def test_entry_details_include_analysis_and_private_photos(setup):
    client, factory, headers, uid = setup
    async with factory() as session:
        repo = UserRepository(session)
        analysis = await repo.create_analysis(
            user_id=uid,
            analysis_type=AnalysisType.FOOD_PHOTO,
            input_text="Обед, примерно 300 г",
            image_path=None,
            previous_analysis_id=None,
            raw_response="Internal model response must not be exposed",
            parsed_json={
                "assumptions": ["Вес порции оценён по фото"],
                "portion_assumed": True,
                "needs_clarification": True,
                "clarification_question": "Добавляли масло?",
            },
            confidence=0.85,
        )
        entry = await repo.create_entry(
            user_id=uid,
            entry_date=date.today(),
            entry_type=EntryType.MEAL,
            title="Обед",
            calories=500,
            ai_analysis_id=analysis.id,
            items=[{"name": "Рис", "quantity": "180 г", "calories": 230}],
            micronutrients={"fiber_g": 4, "sugar_g": 2},
        )
        entry_id = entry.id
        session.add(MobileOperation(
            id="details-operation", user_id=uid, request_key="details-request",
            kind="analyze", status="done", entry_id=entry_id, payload={"text": "Обед"},
        ))
        await session.flush()
        session.add(MobileMedia(
            id="details-photo", user_id=uid, operation_id="details-operation",
            mime="image/jpeg", size=100,
        ))
        await session.commit()

    response = await client.get(f"/v1/entries/{entry_id}", headers=headers)
    assert response.status_code == 200
    detail = response.json()
    assert detail["analysis"]["confidence"] == 0.85
    assert detail["analysis"]["assumptions"] == ["Вес порции оценён по фото"]
    assert detail["analysis"]["portion_assumed"] is True
    assert detail["analysis"]["clarification_question"] == "Добавляли масло?"
    assert detail["analysis"]["input_text"] == "Обед, примерно 300 г"
    assert detail["items"][0]["quantity"] == "180 г"
    assert detail["micronutrients"] == {"fiber_g": 4, "sugar_g": 2}
    assert detail["media"] == [{"id": "details-photo", "mime": "image/jpeg", "url": "/v1/media/details-photo"}]
    assert "raw_response" not in detail["analysis"]
    assert "Internal model response" not in response.text

    other_token, _ = await _login(client, factory, 5012)
    assert (await client.get(
        f"/v1/entries/{entry_id}", headers={"Authorization": f"Bearer {other_token}"}
    )).status_code == 404


async def test_account_deletion_removes_files(setup):
    client, factory, h, uid = setup
    await client.post(
        "/v1/operations",
        headers=h,
        data={"request_key": "delete-media"},
        files={"image": ("food.jpg", b"photo", "image/jpeg")},
    )
    assert list((experience.MEDIA_ROOT / str(uid)).iterdir())
    assert (await client.delete("/v1/account", headers=h)).status_code == 204
    assert not (experience.MEDIA_ROOT / str(uid)).exists()


async def test_demo_payment_never_activates_subscription(setup, monkeypatch):
    client, factory, h, uid = setup
    monkeypatch.delenv("MOBILE_DEMO_BILLING", raising=False)
    assert (
        await client.post("/v1/billing/demo", headers=h, json={"outcome": "success"})
    ).status_code == 404
    monkeypatch.setenv("MOBILE_DEMO_BILLING", "1")
    for outcome in ("success", "declined"):
        response = await client.post(
            "/v1/billing/demo", headers=h, json={"outcome": outcome}
        )
        assert response.json()["status"] == outcome
        assert not response.json()["subscription_changed"]
    async with factory() as session:
        assert (await session.get(User, uid)).subscription_until is None
        assert await session.scalar(select(func.count()).select_from(Payment)) == 0


async def test_premium_data_and_review_are_server_gated(setup):
    client, factory, h, uid = setup
    basic = (await client.get("/v1/stats", headers=h)).json()
    assert basic["advanced_available"] is False
    assert "protein_g" not in basic["days"][0]
    assert basic["days"][0]["calories"] is None
    assert basic["average_calories"] is None
    assert (await client.get("/v1/stats?days=90", headers=h)).status_code == 403
    assert (await client.get("/v1/coach/reviews", headers=h)).status_code == 403
    assert (
        await client.post(
            "/v1/coach/reviews", headers=h, json={"request_key": "premium-test"}
        )
    ).status_code == 403
    async with factory() as session:
        user = await session.get(User, uid)
        user.subscription_until = datetime.now(timezone.utc) + timedelta(days=1)
        await session.commit()
    paid = (await client.get("/v1/stats?days=90", headers=h)).json()
    assert len(paid["days"]) == 90
    assert paid["advanced_available"]
    assert "protein_g" in paid["days"][0]


@pytest.mark.parametrize("premium", [False, True])
async def test_statistics_calendar_counts_all_diary_types_without_leaking_other_users(setup, premium):
    client, factory, headers, uid = setup
    _, other_id = await _login(client, factory, 5077)
    async with factory() as session:
        if premium:
            user = await session.get(User, uid)
            user.subscription_until = datetime.now(timezone.utc) + timedelta(days=1)
            await session.commit()
        repo = UserRepository(session)
        for day, kind in [
            (date(2026, 2, 27), EntryType.MEAL),
            (date(2026, 2, 27), EntryType.WATER),
            (date(2026, 2, 28), EntryType.ACTIVITY),
            (date(2026, 3, 1), EntryType.WATER),
        ]:
            await repo.create_entry(
                user_id=uid, entry_date=day, entry_type=kind,
                title="Запись", calories=100 if kind == EntryType.MEAL else 0,
            )
        await repo.create_entry(
            user_id=other_id, entry_date=date(2026, 3, 2),
            entry_type=EntryType.MEAL, title="Чужая запись", calories=200,
        )
    response = await client.get("/v1/stats?start=2026-02-27&end=2026-03-02", headers=headers)
    assert response.status_code == 200
    result = response.json()
    assert result["advanced_available"] is premium
    assert [day["entry_count"] for day in result["days"]] == [2, 1, 1, 0]
    assert [day["logged"] for day in result["days"]] == [True, False, False, False]
    assert [day["calories"] for day in result["days"]] == [100, None, None, None]
    assert result["average_calories"] == 100
    assert ("protein_g" in result["days"][0]) is premium


async def test_calendar_heatmap_covers_full_month_for_free_accounts_and_is_account_scoped(setup, monkeypatch):
    from src.mobile_api import routes

    client, factory, headers, uid = setup
    _, other_id = await _login(client, factory, 5078)
    monkeypatch.setattr(routes, "local_today", lambda zone: date(2026, 10, 24))
    async with factory() as session:
        repo = UserRepository(session)
        for kind in (EntryType.MEAL, EntryType.WATER, EntryType.ACTIVITY):
            await repo.create_entry(user_id=uid, entry_date=date(2026, 10, 1), entry_type=kind, title="Запись", calories=100)
        await repo.create_entry(user_id=uid, entry_date=date(2026, 9, 30), entry_type=EntryType.MEAL, title="Другой месяц", calories=100)
        await repo.create_entry(user_id=other_id, entry_date=date(2026, 10, 2), entry_type=EntryType.MEAL, title="Чужая запись", calories=100)
    response = await client.get("/v1/stats/calendar", headers=headers)
    assert response.status_code == 200
    result = response.json()
    assert result["today"] == "2026-10-24"
    assert result["month"] == "2026-10"
    assert len(result["days"]) == 31
    assert result["days"][0] == {"date": "2026-10-01", "entry_count": 3}
    assert all(day["entry_count"] == 0 for day in result["days"][1:])
    assert (await client.get("/v1/stats/calendar?month=2024-02", headers=headers)).json()["days"][-1]["date"] == "2024-02-29"
    assert (await client.get("/v1/stats/calendar")).status_code == 401


@pytest.mark.parametrize("month", ["bad", "2026-13", "2026-1", "2026-02-01", "0000-01"])
async def test_calendar_rejects_invalid_months(setup, month):
    client, _, headers, _ = setup
    assert (await client.get(f"/v1/stats/calendar?month={month}", headers=headers)).status_code in (400, 422)


async def test_nutrient_statistics_include_zero_and_preserve_missing_values(setup):
    client, factory, headers, uid = setup
    async with factory() as session:
        repo = UserRepository(session)
        for day, nutrients in [
            (1, {"fiber_g": 2.5, "sugar_g": 0}),
            (1, {"fiber_g": 3, "sugar_g": 4}),
            (2, {"fiber_g": None, "sugar_g": 2}),
            (2, None),
        ]:
            await repo.create_entry(
                user_id=uid,
                entry_date=date(2026, 10, day),
                entry_type=EntryType.MEAL,
                title="Еда",
                calories=100,
                micronutrients=nutrients,
            )
        await repo.create_entry(
            user_id=uid,
            entry_date=date(2026, 10, 3),
            entry_type=EntryType.WATER,
            title="Вода",
            calories=0,
            micronutrients={"fiber_g": 999, "sugar_g": 999},
        )

    path = "/v1/stats?start=2026-10-01&end=2026-10-03"
    response = await client.get(path, headers=headers)
    assert response.status_code == 200
    basic = response.json()
    assert not basic["advanced_available"]
    assert "protein_g" not in basic["days"][0]
    assert [day["fiber_g"] for day in basic["days"]] == [5.5, None, None]
    assert [day["sugar_g"] for day in basic["days"]] == [4, 2, None]
    assert basic["nutrients"]["fiber_g"] == {
        "total": 5.5, "average": 5.5, "recorded_days": 1,
        "meals_with_data": 2, "total_meals": 4,
    }
    assert basic["nutrients"]["sugar_g"] == {
        "total": 6, "average": 3, "recorded_days": 2,
        "meals_with_data": 3, "total_meals": 4,
    }

    async with factory() as session:
        user = await session.get(User, uid)
        user.subscription_until = datetime.now(timezone.utc) + timedelta(days=1)
        await session.commit()
    paid = (await client.get(path, headers=headers)).json()
    assert paid["nutrients"] == basic["nutrients"]
    assert [d["fiber_g"] for d in paid["days"]] == [5.5, None, None]
    empty = (await client.get(
        "/v1/stats?start=2026-10-04&end=2026-10-04", headers=headers
    )).json()
    assert empty["nutrients"]["sugar_g"] == {
        "total": None, "average": None, "recorded_days": 0,
        "meals_with_data": 0, "total_meals": 0,
    }


@pytest.mark.parametrize("entry_type, fields", [
    (EntryType.MEAL, {"calories": 250}),
    (EntryType.WATER, {"calories": 0, "volume_ml": 300}),
    (EntryType.ACTIVITY, {"calories": 160, "duration_minutes": 35}),
])
async def test_favorite_state_survives_reload_in_chat_diary_and_details(setup, entry_type, fields):
    client, factory, headers, uid = setup
    async with factory() as session:
        entry = await UserRepository(session).create_entry(
            user_id=uid,
            entry_date=date.today(),
            entry_type=entry_type,
            title="Запись для избранного",
            **fields,
        )
        entry_id = entry.id

    detail_path = f"/v1/entries/{entry_id}"
    assert (await client.get(detail_path, headers=headers)).json()["favorite_id"] is None
    first = await client.post(f"{detail_path}/favorite", headers=headers)
    assert first.status_code == 200
    favorite_id = first.json()["favorite"]["id"]
    repeated = (await client.post(f"{detail_path}/favorite", headers=headers)).json()
    assert repeated["created"] is False
    assert repeated["favorite"]["id"] == favorite_id

    async def states():
        detail = (await client.get(detail_path, headers=headers)).json()
        chat = (await client.get("/v1/chat", headers=headers)).json()
        diary = (await client.get(f"/v1/days/{date.today()}", headers=headers)).json()
        return [detail["favorite_id"],
                next(e["favorite_id"] for e in chat["entries"] if e["id"] == entry_id),
                next(e["favorite_id"] for e in diary["entries"] if e["id"] == entry_id)]

    assert await states() == [favorite_id] * 3
    saved = (await client.get("/v1/favorites", headers=headers)).json()["favorites"]
    assert len(saved) == 1
    assert saved[0]["entry_type"] == entry_type.value
    assert all(saved[0][key] == value for key, value in fields.items())
    repeated_entry = await client.post(f"/v1/favorites/{favorite_id}/log", headers=headers)
    assert repeated_entry.status_code == 200
    logged = repeated_entry.json()
    assert logged["entry"]["id"] != entry_id
    assert logged["entry"]["entry_type"] == entry_type.value
    assert all(logged["entry"][key] == value for key, value in fields.items())
    if entry_type == EntryType.WATER:
        assert logged["balance"]["water_ml"] == 600
        assert logged["balance"]["consumed"] == 0
    elif entry_type == EntryType.ACTIVITY:
        assert logged["balance"]["activity_bonus"] == 320
        assert logged["balance"]["consumed"] == 0
    other_token, _ = await _login(client, factory, 5012)
    other = {"Authorization": f"Bearer {other_token}"}
    assert (await client.post(f"{detail_path}/favorite", headers=other)).status_code == 404
    assert (await client.delete(f"/v1/favorites/{favorite_id}", headers=other)).status_code == 404
    assert (await client.get("/v1/chat", headers=other)).json()["entries"] == []

    assert (await client.delete(f"/v1/favorites/{favorite_id}", headers=headers)).status_code == 204
    assert await states() == [None] * 3
    assert (await client.get("/v1/favorites", headers=headers)).json()["favorites"] == []


async def test_push_channel_registration_and_no_telegram_duplicate(setup):
    client, factory, h, uid = setup
    assert (
        await client.put("/v1/settings/channel", headers=h, json={"channel": "app"})
    ).status_code == 409
    assert (
        await client.post(
            "/v1/devices",
            headers=h,
            json={"token": "ExpoPushToken[test-device]", "platform": "android"},
        )
    ).status_code == 200
    assert (
        await client.put("/v1/settings/channel", headers=h, json={"channel": "app"})
    ).status_code == 200
    bot = AsyncMock()
    async with factory() as session:
        repo = UserRepository(session)
        user = await session.get(User, uid)
        await notify_user(bot, repo, user, "test", event_key="one")
        await notify_user(bot, repo, user, "test", event_key="one")
        assert await session.scalar(select(func.count()).select_from(PushDelivery)) == 1
    bot.send_message.assert_not_awaited()
    assert (await client.get("/v1/settings", headers=h)).json()[
        "notification_channel"
    ] == "app"


async def test_voice_transcription_reserves_voice_once_and_consumes_draft(
    setup, monkeypatch
):
    client, factory, h, uid = setup
    monkeypatch.setattr(
        experience.AIAnalyzerClient, "transcribe", AsyncMock(return_value="Суп")
    )
    response = await client.post(
        "/v1/voice/transcribe",
        headers=h,
        files={"audio": ("voice.m4a", b"audio", "audio/mp4")},
    )
    assert response.status_code == 200
    draft = response.json()["media_id"]
    data = {"request_key": "voice-job", "text": "Суп с хлебом", "voice_id": draft}
    op = await client.post("/v1/operations", headers=h, data=data)
    assert op.status_code == 202
    assert (
        await client.post(
            "/v1/operations",
            headers=h,
            data={**data, "request_key": "another-voice-job"},
        )
    ).status_code == 409
    usage = (await client.get("/v1/subscription", headers=h)).json()["used"]
    assert usage["voice"] == 1 and usage["text"] == 0


async def test_abandoned_job_can_be_retried(setup):
    client, factory, h, uid = setup
    op = (
        await client.post(
            "/v1/operations",
            headers=h,
            data={"request_key": "abandoned-job", "text": "еда"},
        )
    ).json()
    async with factory() as session:
        job = await session.get(MobileOperation, op["id"])
        job.status = "running"
        job.started_at = datetime.now(timezone.utc) - timedelta(minutes=16)
        await session.commit()
    assert not await worker.process_one()
    result = (await client.get("/v1/operations/" + op["id"], headers=h)).json()
    assert result["status"] == "failed"


async def test_failed_transcription_refunds_voice_quota(setup, monkeypatch):
    from fastapi import HTTPException

    client, factory, h, uid = setup
    monkeypatch.setattr(
        experience.AIAnalyzerClient,
        "transcribe",
        AsyncMock(side_effect=HTTPException(503, "Try later")),
    )
    response = await client.post(
        "/v1/voice/transcribe",
        headers=h,
        files={"audio": ("voice.m4a", b"audio", "audio/mp4")},
    )
    assert response.status_code == 503
    assert (await client.get("/v1/subscription", headers=h)).json()["used"][
        "voice"
    ] == 0
    assert not list((experience.MEDIA_ROOT / str(uid)).glob("*"))


async def test_shared_review_cache_and_refresh_limit(setup, monkeypatch):
    from src.shared import review_service

    client, factory, h, uid = setup
    async with factory() as session:
        user = await session.get(User, uid)
        user.subscription_until = datetime.now(timezone.utc) + timedelta(days=10)
        repo = UserRepository(session)
        await session.commit()
        today = date.today()
        for day in (today, today - timedelta(days=1)):
            await repo.create_entry(
                user_id=uid,
                entry_date=day,
                entry_type=EntryType.MEAL,
                title="Завтрак",
                calories=400,
            )
        writer = AsyncMock(return_value="<b>Разбор</b>\nПо вашим записям")
        action, first = await review_service.get_week_review(repo, user, writer=writer)
        assert action == "generate"
        action, cached = await review_service.get_week_review(repo, user, writer=writer)
        assert action == "cache" and first.id == cached.id
        writer.assert_awaited_once()
        action, updated = await review_service.get_week_review(
            repo, user, refresh=True, writer=writer
        )
        assert action == "refresh" and updated.refresh_used
        action, _ = await review_service.get_week_review(
            repo, user, refresh=True, writer=writer
        )
        assert action == "refresh_spent"
    history = (await client.get("/v1/coach/reviews", headers=h)).json()
    assert history["reviews"][0]["refresh_used"]


async def test_stats_distinguishes_zero_food_from_missing_and_water_only(setup):
    client, factory, h, uid = setup
    async with factory() as session:
        user = await session.get(User, uid)
        user.subscription_until = datetime.now(timezone.utc) + timedelta(days=1)
        await session.commit()
        repo = UserRepository(session)
        await repo.create_entry(
            user_id=uid,
            entry_date=date(2026, 10, 1),
            entry_type=EntryType.MEAL,
            title="Нулевая энергия",
            calories=0,
        )
        await repo.create_entry(
            user_id=uid,
            entry_date=date(2026, 10, 2),
            entry_type=EntryType.WATER,
            title="Вода",
            calories=0,
            volume_ml=250,
        )
    r = (
        await client.get("/v1/stats?start=2026-10-01&end=2026-10-03", headers=h)
    ).json()
    assert r["logged_days"] == 1 and r["average_calories"] == 0
    assert r["days"][0]["calories"] == 0 and r["days"][0]["logged"]
    assert r["days"][1]["calories"] is None and r["days"][1]["water_ml"] == 250
    assert r["days"][2]["water_ml"] is None


async def test_expired_subscription_cannot_read_review_via_job_or_chat(setup):
    client, factory, h, uid = setup
    async with factory() as session:
        session.add(
            MobileOperation(
                id="private-review",
                user_id=uid,
                kind="review",
                request_key="review-key",
                status="done",
                payload={},
                result={"review": {"text": "Paid report"}},
            )
        )
        await session.commit()
    assert (
        await client.get("/v1/operations/private-review", headers=h)
    ).status_code == 403
    assert (
        await client.post("/v1/operations/private-review/retry", headers=h)
    ).status_code == 403
    assert (
        await client.post(
            "/v1/operations",
            headers=h,
            data={"request_key": "review-key", "text": "test"},
        )
    ).status_code == 409
    assert not (await client.get("/v1/chat", headers=h)).json()["operations"]
