from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest

from test_mobile_api import api
from test_mobile_experience import setup
from src.bot.config import settings
from src.bot.services.nutrition import local_today
from src.db.models import DailyRequestUsage, User
from src.mobile_api import worker
from src.mobile_api.request_limits import request_limit_info


@pytest.mark.parametrize("premium,kind", [(False, "photo"), (True, "photo"), (True, "text"), (True, "voice")])
async def test_request_limit_has_usage_reset_and_plan_details(setup, monkeypatch, premium, kind):
    client, factory, headers, uid = setup
    monkeypatch.setattr(settings, "free_photo_daily_limit", 2)
    monkeypatch.setattr(settings, "subscription_daily_request_limit", 5)
    monkeypatch.setattr(settings, "subscription_text_daily_limit", 5)
    monkeypatch.setattr(settings, "subscription_voice_daily_limit", 5)
    limit = 5 if premium else 2
    async with factory() as session:
        user = await session.get(User, uid)
        user.legacy_photo_quota = False
        user.timezone = "Pacific/Kiritimati"
        user.subscription_until = datetime.now(timezone.utc) + timedelta(days=2) if premium else None
        session.add(DailyRequestUsage(
            user_id=uid, usage_date=local_today(user.timezone), request_count=limit,
            photo_count=limit if kind == "photo" else 0,
            text_count=limit if kind == "text" else 0,
            voice_count=limit if kind == "voice" else 0,
        ))
        await session.commit()
    if kind == "voice":
        response = await client.post("/v1/voice/transcribe", headers=headers,
                                     files={"audio": ("voice.m4a", b"audio", "audio/mp4")})
    else:
        response = await client.post(
            "/v1/entries/analyze", headers=headers,
            data={"text": "Обед"},
            files={"image": ("food.jpg", b"photo", "image/jpeg")} if kind == "photo" else None,
        )
    assert response.status_code == 429
    detail = response.json()["detail"]
    assert detail["code"] == "daily_limit_reached"
    assert detail["kind"] == kind
    assert detail["limit"] == detail["used"] == limit
    assert detail["subscription_active"] == premium
    assert detail["can_upgrade"] == (not premium)
    assert detail["timezone"] == "Pacific/Kiritimati"
    reset = datetime.fromisoformat(detail["resets_at"])
    assert reset.hour == reset.minute == 0
    assert reset.utcoffset() == timedelta(hours=14)
    assert reset > datetime.now(timezone.utc)
    assert kind not in detail["alternatives"]

    if kind != "voice":
        queued = (await client.post(
            "/v1/operations", headers=headers,
            data={"request_key": "exhausted-limit", "text": "Обед"},
            files={"image": ("food.jpg", b"photo", "image/jpeg")} if kind == "photo" else None,
        )).json()
        assert await worker.process_one()
        failed = (await client.get(f"/v1/operations/{queued['id']}", headers=headers)).json()
        assert failed["status"] == "failed"
        assert failed["limit_reached"] == detail
        assert failed["error"] == "Достигнут дневной лимит запросов"
        history = (await client.get("/v1/chat", headers=headers)).json()
        assert not history["entries"]
        assert history["operations"][0]["limit_reached"] == detail


async def test_shared_override_does_not_offer_an_upgrade_and_retry_clears_limit(setup, monkeypatch):
    client, factory, headers, uid = setup
    async with factory() as session:
        user = await session.get(User, uid)
        user.daily_request_limit = 0
        await session.commit()
    info = (await client.get("/v1/request-limits?kind=text", headers=headers)).json()
    assert info["limit_mode"] == "shared"
    assert info["limit"] == info["used"] == 0
    assert info["can_upgrade"] is False
    assert not info["alternatives"]
    queued = (await client.post(
        "/v1/operations", headers=headers, data={"request_key": "shared-limit", "text": "Обед"},
    )).json()
    await worker.process_one()
    assert (await client.get(f"/v1/operations/{queued['id']}", headers=headers)).json()["limit_reached"]
    retried = (await client.post(f"/v1/operations/{queued['id']}/retry", headers=headers)).json()
    assert retried["limit_reached"] is None
    assert retried["result"] is None

    async def unrelated_failure(self, user, **kwargs):
        raise RuntimeError("unrelated error")

    monkeypatch.setattr("src.mobile_api.analysis.AnalysisService.analyze", unrelated_failure)
    await worker.process_one()
    failed = (await client.get(f"/v1/operations/{queued['id']}", headers=headers)).json()
    assert failed["limit_reached"] is None
    assert failed["error"] == "Не удалось завершить запрос. Попробуйте ещё раз."


async def test_limit_reset_uses_account_day_and_invalid_timezone_fallback():
    repo = AsyncMock()
    repo.get_daily_usage_counts.return_value = (2, 2, 0, 0)
    user = User(id=1, telegram_id=1, timezone="Pacific/Kiritimati", legacy_photo_quota=False)
    now = datetime(2026, 10, 22, 22, 30, tzinfo=timezone.utc)
    info = await request_limit_info(repo, user, "photo", now=now)
    assert info["resets_at"] == "2026-10-24T00:00:00+14:00"
    user.timezone = "Invalid/Zone"
    info = await request_limit_info(repo, user, "photo", now=now)
    assert info["timezone"] == "UTC"
    assert info["resets_at"] == "2026-10-23T00:00:00+00:00"
