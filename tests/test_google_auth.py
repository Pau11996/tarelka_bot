from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import func, select, update

from test_mobile_api import api, _login
from test_email_auth import register, headers, PASSWORD
from src.bot.config import settings
from src.db.models import EntryType, GoogleLoginChallenge, User
from src.db.repository import UserRepository
from src.mobile_api import email_auth, google_auth

CLIENT_ID = "test-web.apps.googleusercontent.com"


@pytest.fixture
def google(monkeypatch):
    monkeypatch.setattr(settings, "google_web_client_id", CLIENT_ID)
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(google_auth.keys, "get_signing_key_from_jwt", lambda token: SimpleNamespace(key=private.public_key()))

    def token(challenge_nonce, **changes):
        now = int(datetime.now(timezone.utc).timestamp())
        payload = dict(sub="google-person-1", aud=CLIENT_ID, iss="https://accounts.google.com",
            iat=now, exp=now + 300, email="Person@Gmail.com", email_verified=True, nonce=challenge_nonce)
        payload.update(changes)
        return jwt.encode(payload, private, algorithm="RS256", headers={"kid": "test-key"})
    return token


async def body_for(client, google, **claims):
    response = await client.post("/v1/auth/google/start")
    assert response.status_code == 200, response.text
    start = response.json()
    assert start["web_client_id"] == CLIENT_ID
    return dict(challenge_id=start["challenge_id"], id_token=google(start["nonce"], **claims), timezone="Europe/Minsk")


async def test_google_creates_account_reuses_subject_and_preserves_diary(api, google):
    client, factory = api
    body = await body_for(client, google)
    response = await client.post("/v1/auth/google/login", json=body)
    assert response.status_code == 200, response.text
    me = (await client.get("/v1/me", headers=headers(response))).json()
    assert (me["email"], me["auth_method"], me["timezone"]) == ("person@gmail.com", "google", "Europe/Minsk")
    async with factory() as session:
        user = await session.get(User, me["id"])
        assert user.password_hash is None
        await UserRepository(session).create_entry(user_id=user.id, entry_date=date.today(),
            entry_type=EntryType.MEAL, title="Завтрак", calories=400)
    # The same Google subject still opens the same diary after an email change.
    again = await client.post("/v1/auth/google/login", json=await body_for(client, google, email="renamed@gmail.com"))
    assert (await client.get("/v1/me", headers=headers(again))).json()["id"] == me["id"]
    assert (await client.get("/v1/chat", headers=headers(again))).json()["entries"][0]["title"] == "Завтрак"
    assert (await client.get("/v1/settings", headers=headers(again))).json()["notification_channel"] == "app"
    assert (await client.post("/v1/auth/google/login", json=body)).status_code == 401
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(User)) == 1


@pytest.mark.parametrize("email,claims", [("person@gmail.com", {}), ("person@work.example", {"hd": "work.example"})])
async def test_google_links_authoritative_email_and_keeps_password_and_subscription(api, google, email, claims):
    client, factory = api
    original = await register(client, email)
    me = (await client.get("/v1/me", headers=headers(original))).json()
    async with factory() as session:
        user = await session.get(User, me["id"])
        user.subscription_until = datetime.now(timezone.utc) + timedelta(days=10)
        user.auth_version = 3
        await session.commit()
    response = await client.post("/v1/auth/google/login", json=await body_for(client, google, email=email, **claims))
    assert (await client.get("/v1/me", headers=headers(response))).json()["id"] == me["id"]
    assert (await client.get("/v1/subscription", headers=headers(response))).json()["active"] is True
    password_login = await client.post("/v1/auth/email/login", json={"email": email, "password": PASSWORD})
    assert (await client.get("/v1/me", headers=headers(password_login))).json()["id"] == me["id"]


async def test_third_party_email_needs_existing_password_before_linking(api, google):
    client, factory = api
    original = await register(client)
    original_id = (await client.get("/v1/me", headers=headers(original))).json()["id"]
    body = await body_for(client, google, email="person@example.com")
    response = await client.post("/v1/auth/google/login", json=body)
    assert response.json() == {"status": "password_required", "email": "person@example.com"}
    bad = await client.post("/v1/auth/google/login", json={**body, "password": "wrong"})
    assert bad.status_code == 401
    async with factory() as session:
        assert (await session.get(User, original_id)).google_subject is None
    good = await client.post("/v1/auth/google/login", json={**body, "password": PASSWORD})
    assert (await client.get("/v1/me", headers=headers(good))).json()["id"] == original_id


@pytest.mark.parametrize("claims", [
    {"aud": "attacker.apps.googleusercontent.com"}, {"iss": "https://attacker.example"},
    {"exp": 1}, {"iat": 9999999999}, {"email_verified": False}, {"email_verified": "true"},
    {"sub": ""}, {"sub": 123}, {"email": "not-an-email"}, {"nonce": "another-request"},
    {"nonce": None}, {"email": None},
])
async def test_invalid_google_claims_cannot_create_an_account(api, google, claims):
    client, factory = api
    body = await body_for(client, google, **claims)
    response = await client.post("/v1/auth/google/login", json=body)
    assert response.status_code == 401, response.text
    assert body["id_token"] not in response.text
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(User)) == 0


async def test_forged_signature_and_expired_challenge_are_rejected(api, google):
    client, factory = api
    body = await body_for(client, google)
    claims = jwt.decode(body["id_token"], options={"verify_signature": False})
    attacker = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    forged = jwt.encode(claims, attacker, algorithm="RS256")
    assert (await client.post("/v1/auth/google/login", json={**body, "id_token": forged})).status_code == 401
    async with factory() as session:
        await session.execute(update(GoogleLoginChallenge).values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
        await session.commit()
    assert (await client.post("/v1/auth/google/login", json=body)).status_code == 401


async def test_disabled_configuration_and_google_key_outage_fail_closed(api, google, monkeypatch):
    client, _ = api
    body = await body_for(client, google)
    def outage(token):
        raise jwt.PyJWKClientConnectionError("offline")
    monkeypatch.setattr(google_auth.keys, "get_signing_key_from_jwt", outage)
    assert (await client.post("/v1/auth/google/login", json=body)).status_code == 503
    monkeypatch.setattr(settings, "google_web_client_id", "")
    assert (await client.post("/v1/auth/google/start")).status_code == 503
    assert (await client.post("/v1/auth/google/login", json=body)).status_code == 503


async def test_different_google_subject_cannot_take_over_linked_email(api, google):
    client, _ = api
    assert (await client.post("/v1/auth/google/login", json=await body_for(client, google))).status_code == 200
    response = await client.post("/v1/auth/google/login", json=await body_for(client, google, sub="other-google-account"))
    assert response.status_code == 409


async def test_google_only_account_can_set_password_using_email_recovery(api, google, monkeypatch):
    client, _ = api
    original = await client.post("/v1/auth/google/login", json=await body_for(client, google))
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "smtp_from", "hello@example.test")
    mail = AsyncMock()
    monkeypatch.setattr(email_auth, "send_reset_code", mail)
    assert (await client.post("/v1/auth/email/forgot-password", json={"email": "person@gmail.com"})).status_code == 200
    code = mail.await_args.args[1]
    response = await client.post("/v1/auth/email/reset-password", json={"email": "person@gmail.com", "code": code, "password": PASSWORD})
    assert response.status_code == 200
    assert (await client.get("/v1/me", headers=headers(original))).status_code == 401
    assert (await client.post("/v1/auth/email/login", json={"email": "person@gmail.com", "password": PASSWORD})).status_code == 200


async def test_google_diary_stays_separate_from_telegram(api, google):
    client, factory = api
    _, tg_id = await _login(client, factory, 813000)
    response = await client.post("/v1/auth/google/login", json=await body_for(client, google))
    me = (await client.get("/v1/me", headers=headers(response))).json()
    assert me["id"] != tg_id
    assert me["telegram_id"] is None


async def test_google_challenge_has_an_attempt_limit(api, google):
    client, _ = api
    body = await body_for(client, google, nonce="wrong")
    for _ in range(8):
        assert (await client.post("/v1/auth/google/login", json=body)).status_code == 401
    response = await client.post("/v1/auth/google/login", json=body)
    assert response.status_code == 429
    assert int(response.headers["retry-after"]) > 0
