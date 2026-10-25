from datetime import datetime, timedelta, timezone
import smtplib
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import delete, select, update

from test_email_auth import PASSWORD, headers, register
from test_mobile_api import api
from src.bot.config import settings
from src.db.models import AuthRateLimit, PasswordResetCode, User
from src.mobile_api import email_auth, email_delivery


@pytest.fixture
def mail(monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "smtp_from", "ТАРЕЛКА <hello@example.test>")
    sender = AsyncMock()
    monkeypatch.setattr(email_auth, "send_reset_code", sender)
    return sender


async def request_code(client, mail, email="person@example.com"):
    response = await client.post("/v1/auth/email/forgot-password", json={"email": email})
    assert response.status_code == 200
    code = mail.await_args.args[1]
    assert len(code) == 6 and code.isdigit()
    assert code not in response.text
    return code


async def reset(client, code, email="person@example.com", password="New strong password 42!"):
    return await client.post("/v1/auth/email/reset-password", json={"email": email, "code": code, "password": password})


async def clear_limits(factory):
    async with factory() as session:
        await session.execute(delete(AuthRateLimit))
        await session.commit()


async def test_recovery_changes_password_once_preserves_account_and_revokes_old_sessions(api, mail):
    client, factory = api
    old = headers(await register(client))
    me = (await client.get("/v1/me", headers=old)).json()
    code = await request_code(client, mail, " Person@Example.COM ")
    assert mail.await_args.args[0] == "person@example.com"
    async with factory() as session:
        stored = await session.get(PasswordResetCode, me["id"])
        assert stored.code_hash != code and len(stored.code_hash) == 64
    assert (await reset(client, code)).status_code == 200
    assert (await reset(client, code)).status_code == 400
    assert (await client.get("/v1/me", headers=old)).status_code == 401
    assert (await client.post("/v1/auth/email/login", json={"email": me["email"], "password": PASSWORD})).status_code == 401
    login = await client.post("/v1/auth/email/login", json={"email": me["email"], "password": "New strong password 42!"})
    assert (await client.get("/v1/me", headers=headers(login))).json()["id"] == me["id"]
    async with factory() as session:
        assert await session.get(PasswordResetCode, me["id"]) is None


async def test_missing_email_has_same_response_without_sending_or_creating_an_account(api, mail):
    client, factory = api
    await register(client)
    known = await client.post("/v1/auth/email/forgot-password", json={"email": "person@example.com"})
    missing = await client.post("/v1/auth/email/forgot-password", json={"email": "missing@example.com"})
    assert known.status_code == missing.status_code == 200
    assert known.json() == missing.json()
    assert mail.await_count == 1
    assert (await reset(client, "123456", email="missing@example.com")).status_code == 400
    async with factory() as session:
        assert await session.scalar(select(User.id).where(User.email == "missing@example.com")) is None


async def test_expired_wrong_and_other_account_codes_cannot_change_password(api, mail):
    client, factory = api
    old = headers(await register(client))
    await register(client, "other@example.com")
    code = await request_code(client, mail)
    wrong = "000000" if code != "000000" else "999999"
    assert (await reset(client, wrong)).status_code == 400
    assert (await reset(client, code, email="other@example.com")).status_code == 400
    async with factory() as session:
        await session.execute(update(PasswordResetCode).values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
        await session.commit()
    assert (await reset(client, code)).status_code == 400
    assert (await client.get("/v1/me", headers=old)).status_code == 200


async def test_resending_replaces_code_and_verification_is_limited(api, mail):
    client, factory = api
    await register(client)
    first = await request_code(client, mail)
    blocked = await client.post("/v1/auth/email/forgot-password", json={"email": "person@example.com"})
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0
    assert mail.await_count == 1
    await clear_limits(factory)
    second = await request_code(client, mail)
    if first != second:
        assert (await reset(client, first)).status_code == 400
    await clear_limits(factory)
    wrong = "000000" if second != "000000" else "999999"
    for _ in range(5):
        assert (await reset(client, wrong)).status_code == 400
    assert (await reset(client, second)).status_code == 429


async def test_delivery_failure_does_not_replace_previous_code(api, mail):
    client, factory = api
    await register(client)
    code = await request_code(client, mail)
    await clear_limits(factory)
    mail.side_effect = smtplib.SMTPException("provider rejected")
    response = await client.post("/v1/auth/email/forgot-password", json={"email": "person@example.com"})
    assert response.status_code == 503
    assert "provider rejected" not in response.text
    assert (await reset(client, code)).status_code == 200


async def test_missing_smtp_reports_unavailable_without_pretending_to_send(api, mail, monkeypatch):
    client, _ = api
    monkeypatch.setattr(settings, "smtp_host", "")
    response = await client.post("/v1/auth/email/forgot-password", json={"email": "person@example.com"})
    assert response.status_code == 503
    mail.assert_not_awaited()


async def test_invalid_new_password_keeps_code_usable_and_secrets_out_of_response(api, mail):
    client, _ = api
    await register(client)
    code = await request_code(client, mail)
    for password in ("short", "x" * 129):
        response = await reset(client, code, password=password)
        assert response.status_code == 400
        assert password not in response.text
        assert code not in response.text
    assert (await reset(client, code)).status_code == 200


@pytest.mark.parametrize("security", ["starttls", "ssl"])
def test_mail_transport_uses_tls_and_delivers_the_code_to_the_requested_address(monkeypatch, security):
    from pydantic import SecretStr
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "smtp_from", "ТАРЕЛКА <hello@example.test>")
    monkeypatch.setattr(settings, "smtp_username", "mailer")
    monkeypatch.setattr(settings, "smtp_password", SecretStr("test-only-secret"))
    monkeypatch.setattr(settings, "smtp_security", security)
    connection = MagicMock()
    smtp_class = MagicMock()
    smtp_class.return_value.__enter__.return_value = connection
    monkeypatch.setattr(email_delivery.smtplib, "SMTP_SSL" if security == "ssl" else "SMTP", smtp_class)
    email_delivery._send_reset_code("person@example.com", "012345")
    connection.login.assert_called_once_with("mailer", "test-only-secret")
    if security == "starttls":
        connection.starttls.assert_called_once()
    else:
        assert smtp_class.call_args.kwargs["context"].check_hostname is True
    message = connection.send_message.call_args.args[0]
    assert message["To"] == "person@example.com"
    assert "012345" in message.get_content()
    assert "10 минут" in message.get_content()


def test_migration_preserves_existing_users_and_adds_recovery_storage(monkeypatch):
    import importlib
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, inspect, text
    migration = importlib.import_module("migrations.versions.022_email_password_reset")
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        connection.execute(text("INSERT INTO users (id) VALUES (42)"))
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
        migration.upgrade()
        assert connection.execute(text("SELECT auth_version FROM users WHERE id=42")).scalar() == 0
        assert "password_reset_codes" in inspect(connection).get_table_names()
        migration.downgrade()
        assert connection.execute(text("SELECT id FROM users")).scalar() == 42
        assert "password_reset_codes" not in inspect(connection).get_table_names()
    engine.dispose()
