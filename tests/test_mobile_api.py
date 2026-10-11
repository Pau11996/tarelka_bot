from datetime import date, datetime, timezone
from urllib.parse import parse_qs, urlparse

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from src.db.models import Base, EntryType, Payment
from src.db.repository import UserRepository
from src.db.session import get_session
from src.mobile_api.login_codes import app_login_code
from src.mobile_api.main import app


def _same_moment(left: datetime, right: datetime) -> bool:
    if left.tzinfo is None:
        left = left.replace(tzinfo=timezone.utc)
    if right.tzinfo is None:
        right = right.replace(tzinfo=timezone.utc)
    return left == right


@pytest.fixture
async def api():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override_session():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, factory
    app.dependency_overrides.clear()
    await engine.dispose()


def test_app_login_code_reads_start_payload() -> None:
    assert app_login_code("app_abc") == "abc"
    assert app_login_code("premium") is None
    assert app_login_code("app_") is None
    assert app_login_code(None) is None


async def _login(client: AsyncClient, factory, telegram_id: int) -> tuple[str, int]:
    started = await client.post("/v1/auth/telegram/start")
    assert started.status_code == 200
    body = started.json()
    code = body["code"]
    start_payload = parse_qs(urlparse(body["bot_url"]).query)["start"][0]
    assert app_login_code(start_payload) == code

    pending = await client.get(f"/v1/auth/telegram/{code}")
    assert pending.status_code == 202

    async with factory() as session:
        repo = UserRepository(session)
        user = await repo.get_or_create_user(telegram_id, "Europe/Moscow")
        assert await repo.attach_mobile_login(code, user.id)
        user_id = user.id

    confirmed = await client.get(f"/v1/auth/telegram/{code}")
    assert confirmed.status_code == 200
    token = confirmed.json()["access_token"]

    me = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["telegram_id"] == telegram_id
    assert me.json()["id"] == user_id

    reused = await client.get(f"/v1/auth/telegram/{code}")
    assert reused.status_code == 410
    return token, user_id


async def test_login_binds_the_same_telegram_user(api) -> None:
    client, factory = api
    await _login(client, factory, 4242)


async def test_other_user_cannot_read_or_delete_entry(api) -> None:
    client, factory = api
    owner_token, owner_id = await _login(client, factory, 1001)
    other_token, _other_id = await _login(client, factory, 1002)

    async with factory() as session:
        entry = await UserRepository(session).create_entry(
            user_id=owner_id,
            entry_date=date.today(),
            entry_type=EntryType.MEAL,
            title="Борщ",
            calories=300,
        )
        entry_id = entry.id

    other_headers = {"Authorization": f"Bearer {other_token}"}
    hidden = await client.get(f"/v1/entries/{entry_id}", headers=other_headers)
    assert hidden.status_code == 404
    deleted = await client.delete(f"/v1/entries/{entry_id}", headers=other_headers)
    assert deleted.status_code == 404

    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    visible = await client.get(f"/v1/entries/{entry_id}", headers=owner_headers)
    assert visible.status_code == 200
    assert visible.json()["title"] == "Борщ"

    async with factory() as session:
        still = await UserRepository(session).get_entry(entry_id, owner_id)
        assert still is not None
        assert still.title == "Борщ"


async def test_checkout_stub_does_not_change_subscription_or_payments(api) -> None:
    client, factory = api
    token, user_id = await _login(client, factory, 777)
    until = datetime(2030, 1, 2, tzinfo=timezone.utc)

    async with factory() as session:
        user = await UserRepository(session).get_user_by_id(user_id)
        assert user is not None
        user.subscription_until = until
        session.add(
            Payment(
                user_id=user_id,
                telegram_payment_charge_id="charge-1",
                stars_amount=150,
                subscription_until=until,
            )
        )
        await session.commit()

    response = await client.post(
        "/v1/billing/checkout",
        json={"plan": "monthly"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "unavailable"
    assert "карт" in body["message"].lower()

    async with factory() as session:
        user = await UserRepository(session).get_user_by_id(user_id)
        assert user is not None
        assert user.subscription_until is not None
        assert _same_moment(user.subscription_until, until)
        count = await session.execute(select(func.count()).select_from(Payment))
        assert count.scalar_one() == 1


async def test_settings_notifications_and_account_deletion(api) -> None:
    client, factory = api
    token, user_id = await _login(client, factory, 5151)
    headers = {"Authorization": f"Bearer {token}"}

    settings = await client.get("/v1/settings", headers=headers)
    assert settings.status_code == 200
    body = settings.json()
    assert body["notifications_enabled"] is True
    assert body["referral_bonus_requests"] >= 1
    assert body["support_email"]

    updated = await client.put("/v1/settings/notifications", json={"enabled": False}, headers=headers)
    assert updated.status_code == 200
    assert updated.json()["notifications_enabled"] is False

    deleted = await client.delete("/v1/account", headers=headers)
    assert deleted.status_code == 204

    async with factory() as session:
        assert await UserRepository(session).get_user_by_id(user_id) is None
