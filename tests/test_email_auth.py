from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select, update

from test_mobile_api import api, _login
from src.ai_analyzer.broadcast import BroadcastAudience, list_broadcast_telegram_ids
from src.bot.config import settings
from src.db.models import AuthRateLimit, EntryType, User
from src.db.repository import UserRepository
from src.mobile_api import experience, worker
from src.mobile_api.analysis import AnalysisService
from src.mobile_api.passwords import hash_password, verify_password


PASSWORD = "Correct horse battery 42!"


async def register(client, email="person@example.com", password=PASSWORD):
    return await client.post("/v1/auth/email/register", json={
        "email": email, "password": password, "timezone": "Europe/Minsk",
    })


def headers(response):
    assert response.status_code in (200, 201)
    return {"Authorization": "Bearer " + response.json()["access_token"]}


def test_password_hashes_are_salted_and_preserve_the_whole_password():
    password = "  Очень длинный пароль 🔐 " + "a" * 80
    first, second = hash_password(password), hash_password(password)
    assert first != second
    assert password not in first
    assert verify_password(password, first)
    assert not verify_password(password.strip(), first)
    assert not verify_password(password[:-1], first)
    assert not verify_password(password, "not-a-valid-hash")


async def test_register_and_login_work_without_a_telegram_bot(api, monkeypatch):
    client, factory = api
    monkeypatch.setattr(settings, "telegram_bot_token", "")
    monkeypatch.setattr(settings, "telegram_bot_username", "")
    response = await register(client, " Person@Example.COM ")
    assert response.status_code == 201
    h = headers(response)
    me = (await client.get("/v1/me", headers=h)).json()
    assert me["email"] == "person@example.com"
    assert me["auth_method"] == "email"
    assert me["telegram_id"] is None
    assert me["timezone"] == "Europe/Minsk"
    async with factory() as session:
        user = await session.get(User, me["id"])
        assert user.password_hash != PASSWORD
        assert verify_password(PASSWORD, user.password_hash)
    login = await client.post("/v1/auth/email/login", json={
        "email": "PERSON@example.com", "password": PASSWORD,
    })
    assert login.status_code == 200
    assert (await client.get("/v1/me", headers=headers(login))).json()["id"] == me["id"]
    assert PASSWORD not in response.text
    assert "password_hash" not in me
    today = (await client.get("/v1/today", headers=h)).json()
    assert today["entries"] == []
    assert today["profile_complete"] is False
    assert (await client.get("/v1/chat", headers=h)).json()["entries"] == []
    settings_response = (await client.get("/v1/settings", headers=h)).json()
    assert settings_response["notification_channel"] == "app"
    assert settings_response["telegram_connected"] is False
    assert (await client.put("/v1/settings/channel", headers=h, json={"channel": "telegram"})).status_code == 400


async def test_email_and_telegram_diaries_stay_separate(api):
    client, factory = api
    tg_token, tg_id = await _login(client, factory, 70051)
    tg_headers = {"Authorization": "Bearer " + tg_token}
    async with factory() as session:
        entry = await UserRepository(session).create_entry(
            user_id=tg_id, entry_date=date.today(), entry_type=EntryType.MEAL,
            title="Дневник Telegram", calories=500,
        )
        entry_id = entry.id
    email_headers = headers(await register(client))
    email_id = (await client.get("/v1/me", headers=email_headers)).json()["id"]
    assert email_id != tg_id
    assert (await client.get("/v1/chat", headers=email_headers)).json()["entries"] == []
    assert (await client.get(f"/v1/entries/{entry_id}", headers=email_headers)).status_code == 404
    assert (await client.delete(f"/v1/entries/{entry_id}", headers=email_headers)).status_code == 404
    await client.put("/v1/profile", headers=email_headers, json={"daily_calorie_target": 1700})
    assert (await client.get("/v1/profile", headers=tg_headers)).json()["daily_calorie_target"] == 2000
    _, relogged_id = await _login(client, factory, 70051)
    assert relogged_id == tg_id
    assert (await client.get("/v1/chat", headers=tg_headers)).json()["entries"][0]["id"] == entry_id
    assert (await client.delete("/v1/account", headers=email_headers)).status_code == 204
    assert (await client.get("/v1/me", headers=email_headers)).status_code == 401
    assert (await client.get(f"/v1/entries/{entry_id}", headers=tg_headers)).status_code == 200
    login = await client.post("/v1/auth/email/login", json={"email": "person@example.com", "password": PASSWORD})
    assert login.status_code == 401


async def test_duplicate_email_is_case_insensitive_and_does_not_replace_credentials(api):
    client, factory = api
    assert (await register(client)).status_code == 201
    assert (await register(client, "PERSON@EXAMPLE.COM", "another-password")).status_code == 409
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(User)) == 1
    bad = await client.post("/v1/auth/email/login", json={"email": "person@example.com", "password": "another-password"})
    missing = await client.post("/v1/auth/email/login", json={"email": "nobody@example.com", "password": "another-password"})
    assert bad.status_code == missing.status_code == 401
    assert bad.json() == missing.json()


@pytest.mark.parametrize("email,password", [("not-an-email", PASSWORD), ("a@b.com", "short"), ("a@b.com", "x" * 129)])
async def test_invalid_registration_does_not_create_users_or_echo_passwords(api, email, password):
    client, factory = api
    response = await register(client, email, password)
    assert response.status_code in (400, 422)
    assert password not in response.text
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(User)) == 0


async def test_login_rate_limit_is_persistent_and_expires(api):
    client, factory = api
    assert (await register(client)).status_code == 201
    for _ in range(10):
        response = await client.post("/v1/auth/email/login", json={"email": "person@example.com", "password": "wrong"})
        assert response.status_code == 401
    blocked = await client.post("/v1/auth/email/login", json={"email": "person@example.com", "password": PASSWORD})
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0
    async with factory() as session:
        await session.execute(update(AuthRateLimit).values(resets_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
        await session.commit()
    assert (await client.post("/v1/auth/email/login", json={"email": "person@example.com", "password": PASSWORD})).status_code == 200


async def test_email_account_can_save_and_reload_food_photo(api, monkeypatch, tmp_path):
    client, factory = api
    h = headers(await register(client))
    monkeypatch.setattr(experience, "MEDIA_ROOT", tmp_path)
    monkeypatch.setattr(worker, "async_session_factory", factory)
    from sqlalchemy.ext.asyncio import async_sessionmaker
    monkeypatch.setattr(worker, "atomic_factory", async_sessionmaker(factory.kw["bind"], class_=worker.AtomicSession, expire_on_commit=False))
    monkeypatch.setattr(worker, "_reward_referrer", AsyncMock())

    async def analyze(self, user, **kwargs):
        assert user.telegram_id is None
        entry = await self.repo.create_entry(
            user_id=user.id, entry_date=date.today(), entry_type=EntryType.MEAL,
            title="Мой первый обед", calories=400,
        )
        return {"status": "saved", "entry": {"id": entry.id}, "balance": {}}

    monkeypatch.setattr(AnalysisService, "analyze", analyze)
    response = await client.post("/v1/operations", headers=h, data={"request_key": "email-photo-first"}, files={"image": ("food.jpg", b"photo-bytes", "image/jpeg")})
    assert response.status_code == 202
    assert await worker.process_one()
    history = (await client.get("/v1/chat", headers=h)).json()
    assert history["entries"][0]["title"] == "Мой первый обед"
    assert history["operations"][0]["status"] == "done"
    assert (await client.get(history["media"][0]["url"], headers=h)).content == b"photo-bytes"


async def test_telegram_broadcast_skips_email_accounts(api):
    client, factory = api
    await register(client)
    await _login(client, factory, 70052)
    async with factory() as session:
        ids = await list_broadcast_telegram_ids(session, BroadcastAudience.ALL)
        assert ids == [70052]
