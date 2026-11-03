from datetime import datetime, timedelta, timezone
from email import policy
from email.parser import BytesParser
import importlib
import smtplib
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, delete, func, inspect, select, text, update

from test_mobile_api import api
from src.bot.config import settings
from src.db.models import AuthRateLimit, EmailRegistration, NotificationPreference, Profile, User
from src.mobile_api import email_delivery, email_registration
from src.mobile_api.passwords import hash_password, verify_password

PASSWORD = "Correct horse battery 42!"


@pytest.fixture
def mail(monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "smtp_from", "hello@example.test")
    sender = AsyncMock()
    monkeypatch.setattr(email_registration, "send_registration_code", sender)
    return sender


async def begin(client, email="person@example.com", password=PASSWORD):
    return await client.post("/v1/auth/email/register", json={
        "email": email, "password": password, "timezone": "Europe/Minsk",
    })


async def verify(client, registration, code):
    return await client.post("/v1/auth/email/register/verify", json={"registration_id": registration, "code": code})


async def clear_limits(factory):
    async with factory() as session:
        await session.execute(delete(AuthRateLimit))
        await session.commit()


async def test_registration_creates_no_account_or_session_until_email_is_verified(api, mail):
    client, factory = api
    response = await begin(client, " Person@Example.COM ")
    assert response.status_code == 202, response.text
    pending = response.json()
    assert "access_token" not in pending
    assert pending["email"] == "person@example.com"
    assert pending["expires_in"] == 600 and pending["resend_after"] == 60
    code = mail.await_args.args[1]
    assert mail.await_args.args[0] == "person@example.com"
    assert len(code) == 6 and code.isdigit() and code not in response.text
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(User)) == 0
        assert await session.scalar(select(func.count()).select_from(Profile)) == 0
        stored = await session.get(EmailRegistration, pending["registration_id"])
        assert verify_password(PASSWORD, stored.password_hash)
        assert stored.code_hash != code and len(stored.code_hash) == 64
    assert (await client.post("/v1/auth/email/login", json={"email": pending["email"], "password": PASSWORD})).status_code == 401
    verified = await verify(client, pending["registration_id"], code)
    assert verified.status_code == 201, verified.text
    h = {"Authorization": f"Bearer {verified.json()['access_token']}"}
    me = (await client.get("/v1/me", headers=h)).json()
    assert me["email"] == pending["email"] and me["timezone"] == "Europe/Minsk"
    async with factory() as session:
        assert await session.get(EmailRegistration, pending["registration_id"]) is None
        assert await session.get(NotificationPreference, me["id"])
        assert await session.scalar(select(func.count()).select_from(User)) == 1
    assert (await verify(client, pending["registration_id"], code)).status_code == 400


async def test_expired_wrong_and_unrelated_codes_cannot_create_accounts(api, mail):
    client, factory = api
    pending = (await begin(client)).json()["registration_id"]
    code = mail.await_args.args[1]
    wrong = "000000" if code != "000000" else "999999"
    assert (await verify(client, pending, wrong)).status_code == 400
    assert (await verify(client, str(uuid4()), code)).status_code == 400
    async with factory() as session:
        await session.execute(update(EmailRegistration).values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
        await session.commit()
    assert (await verify(client, pending, code)).status_code == 400
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(User)) == 0


async def test_codes_are_bound_to_the_registration_and_password(api, mail, monkeypatch):
    client, factory = api
    codes = iter([123456, 234567, 345678])
    monkeypatch.setattr(email_registration.secrets, "randbelow", lambda _: next(codes))
    first = (await begin(client)).json()["registration_id"]
    first_code = mail.await_args.args[1]
    other = (await begin(client, "other@example.com")).json()["registration_id"]
    assert (await verify(client, other, first_code)).status_code == 400
    await clear_limits(factory)
    latest = (await begin(client, password="The replacement password")).json()["registration_id"]
    assert latest != first
    assert (await verify(client, first, first_code)).status_code == 400
    assert (await verify(client, latest, first_code)).status_code == 400
    assert (await verify(client, latest, mail.await_args.args[1])).status_code == 201
    bad = await client.post("/v1/auth/email/login", json={"email": "person@example.com", "password": PASSWORD})
    assert bad.status_code == 401


async def test_resend_obeys_cooldown_rotates_code_and_limits_guesses(api, mail, monkeypatch):
    client, factory = api
    monkeypatch.setattr(email_registration.secrets, "randbelow", lambda _: 123456)
    pending = (await begin(client)).json()["registration_id"]
    first = mail.await_args.args[1]
    body = {"registration_id": pending}
    blocked = await client.post("/v1/auth/email/register/resend", json=body)
    assert blocked.status_code == 429 and int(blocked.headers["retry-after"]) > 0
    assert mail.await_count == 1
    await clear_limits(factory)
    assert (await client.post("/v1/auth/email/register/resend", json=body)).status_code == 200
    second = mail.await_args.args[1]
    assert second != first
    assert (await verify(client, pending, first)).status_code == 400
    await clear_limits(factory)
    for _ in range(5):
        assert (await verify(client, pending, "000000")).status_code == 400
    assert (await verify(client, pending, second)).status_code == 429
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(User)) == 0


async def test_failed_delivery_preserves_the_previous_usable_code(api, mail):
    client, factory = api
    pending = (await begin(client)).json()["registration_id"]
    code = mail.await_args.args[1]
    await clear_limits(factory)
    mail.side_effect = smtplib.SMTPException("private provider failure")
    response = await client.post("/v1/auth/email/register/resend", json={"registration_id": pending})
    assert response.status_code == 503 and "private provider failure" not in response.text
    assert (await verify(client, pending, code)).status_code == 201


async def test_failed_replacement_registration_keeps_the_original_password_and_code(api, mail):
    client, factory = api
    pending = (await begin(client)).json()["registration_id"]
    code = mail.await_args.args[1]
    await clear_limits(factory)
    mail.side_effect = OSError("unavailable")
    assert (await begin(client, password="Replacement password")).status_code == 503
    assert (await verify(client, pending, code)).status_code == 201
    assert (await client.post("/v1/auth/email/login", json={"email": "person@example.com", "password": PASSWORD})).status_code == 200


async def test_an_expired_code_can_be_renewed_but_old_registrations_must_restart(api, mail):
    client, factory = api
    pending = (await begin(client)).json()["registration_id"]
    async with factory() as session:
        await session.execute(update(EmailRegistration).values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
        await session.commit()
    await clear_limits(factory)
    assert (await client.post("/v1/auth/email/register/resend", json={"registration_id": pending})).status_code == 200
    assert (await verify(client, pending, mail.await_args.args[1])).status_code == 201
    old = (await begin(client, "old@example.com")).json()["registration_id"]
    async with factory() as session:
        await session.execute(update(EmailRegistration).values(created_at=datetime.now(timezone.utc) - timedelta(days=2)))
        await session.commit()
    await clear_limits(factory)
    assert (await client.post("/v1/auth/email/register/resend", json={"registration_id": old})).status_code == 400
    assert (await begin(client, "fresh@example.com")).status_code == 202
    async with factory() as session:
        assert await session.get(EmailRegistration, old) is None


async def test_missing_smtp_and_failed_initial_delivery_create_nothing(api, mail, monkeypatch):
    client, factory = api
    monkeypatch.setattr(settings, "smtp_host", "")
    assert (await begin(client)).status_code == 503
    mail.assert_not_awaited()
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.test")
    mail.side_effect = OSError("private SMTP detail")
    response = await begin(client, "other@example.com")
    assert response.status_code == 503 and "private SMTP detail" not in response.text
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(EmailRegistration)) == 0
        assert await session.scalar(select(func.count()).select_from(User)) == 0


async def test_existing_email_account_still_logs_in_and_cannot_be_overwritten(api, mail):
    client, factory = api
    async with factory() as session:
        user = User(email="person@example.com", password_hash=hash_password(PASSWORD), timezone="UTC")
        session.add(user)
        await session.commit()
    assert (await client.post("/v1/auth/email/login", json={"email": "person@example.com", "password": PASSWORD})).status_code == 200
    assert (await begin(client, password="some other password")).status_code == 409
    mail.assert_not_awaited()


@pytest.mark.parametrize("security", ["starttls", "ssl"])
@pytest.mark.parametrize("send, subject, instruction", [
    (email_delivery.send_registration_code, "Подтвердите почту", "завершить регистрацию"),
    (email_delivery.send_reset_code, "Код восстановления пароля", "задайте новый пароль"),
])
async def test_code_email_has_matching_html_and_plain_text_over_tls(monkeypatch, security, send, subject, instruction):
    transport = MagicMock()
    smtp = transport.return_value.__enter__.return_value
    monkeypatch.setattr(email_delivery.smtplib, "SMTP", transport)
    monkeypatch.setattr(email_delivery.smtplib, "SMTP_SSL", transport)
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "smtp_from", "hello@example.test")
    monkeypatch.setattr(settings, "smtp_username", "")
    monkeypatch.setattr(settings, "smtp_security", security)

    await send("person@example.com", "012345")

    smtp.send_message.assert_called_once()
    message = BytesParser(policy=policy.default).parsebytes(smtp.send_message.call_args.args[0].as_bytes())
    assert message["To"] == "person@example.com" and subject in message["Subject"]
    assert message.get_content_type() == "multipart/alternative"
    assert [part.get_content_type() for part in message.iter_parts()] == ["text/plain", "text/html"]
    for subtype in ("plain", "html"):
        content = message.get_body(preferencelist=(subtype,)).get_content()
        assert "012345" in content and "10 минут" in content and instruction in content
    if security == "starttls":
        smtp.starttls.assert_called_once()
        assert smtp.starttls.call_args.kwargs["context"].check_hostname
    else:
        smtp.starttls.assert_not_called()
        assert transport.call_args.kwargs["context"].check_hostname


def test_migration_preserves_existing_users_and_round_trips(monkeypatch):
    migration = importlib.import_module("migrations.versions.025_email_verification")
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)"))
        connection.execute(text("INSERT INTO users (id, email) VALUES (42, 'old@example.com')"))
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
        for _ in range(2):
            migration.upgrade()
            assert "email_registrations" in inspect(connection).get_table_names()
            assert inspect(connection).get_indexes("email_registrations")[0]["unique"]
            migration.downgrade()
            assert "email_registrations" not in inspect(connection).get_table_names()
            assert connection.execute(text("SELECT email FROM users WHERE id=42")).scalar() == "old@example.com"
    engine.dispose()
