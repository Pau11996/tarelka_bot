from datetime import date
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from test_mobile_api import api, _login
from src.db.models import EntryType
from src.db.repository import UserRepository


@pytest.fixture
async def favorites(api):
    client, factory = api
    token, uid = await _login(client, factory, 5901)
    async with factory() as session:
        repo = UserRepository(session)
        for kind, title in [(EntryType.MEAL, "Омлет"), (EntryType.WATER, "Вода"), (EntryType.ACTIVITY, "Прогулка")]:
            entry = await repo.create_entry(user_id=uid, entry_date=date.today(), entry_type=kind, title=title, calories=100)
            await repo.create_favorite_from_entry(entry)
        ids = [item.id for item in await repo.get_favorites(uid)]
    return client, factory, {"Authorization": f"Bearer {token}"}, uid, ids


async def test_order_is_shared_persistent_and_retryable_and_new_favorites_stay_first(favorites):
    client, factory, headers, uid, original = favorites
    ordered = original[1:] + original[:1]
    body = {"favorite_ids": ordered, "original_ids": original}
    for _ in range(2):
        result = await client.put("/v1/favorites/order", headers=headers, json=body)
        assert result.status_code == 200
        assert [item["id"] for item in result.json()["favorites"]] == ordered
    async with factory() as session:
        repo = UserRepository(session)
        # The bot reads this exact repository, in a fresh session.
        assert [item.id for item in await repo.get_favorites(uid)] == ordered
        entry = await repo.create_entry(user_id=uid, entry_date=date.today(), entry_type=EntryType.MEAL, title="Новое", calories=10)
        new = await repo.create_favorite_from_entry(entry)
        duplicate = await repo.create_favorite_from_entry(entry)
        assert duplicate.id == new.id
        assert [item.id for item in await repo.get_favorites(uid)] == [new.id, *ordered]
        await repo.delete_favorite(await repo.get_favorite(ordered[1], uid))
    result = await client.get("/v1/favorites", headers=headers)
    assert [item["id"] for item in result.json()["favorites"]] == [new.id, ordered[0], ordered[2]]


@pytest.mark.parametrize("change", ["reorder", "add", "delete"])
async def test_stale_editor_cannot_overwrite_changes_from_another_client(favorites, change):
    client, factory, headers, uid, original = favorites
    async with factory() as session:
        repo = UserRepository(session)
        if change == "reorder":
            await repo.reorder_favorites(uid, original[1:] + original[:1], original)
        elif change == "delete":
            await repo.delete_favorite(await repo.get_favorite(original[0], uid))
        else:
            entry = await repo.create_entry(user_id=uid, entry_date=date.today(), entry_type=EntryType.WATER, title="Новая вода", calories=0)
            await repo.create_favorite_from_entry(entry)
        expected = [item.id for item in await repo.get_favorites(uid)]
    result = await client.put("/v1/favorites/order", headers=headers, json={"favorite_ids": original[::-1], "original_ids": original})
    assert result.status_code == 409
    assert [item["id"] for item in (await client.get("/v1/favorites", headers=headers)).json()["favorites"]] == expected


async def test_invalid_partial_and_foreign_orders_never_change_favorites(favorites):
    client, factory, headers, uid, original = favorites
    other_token, other_uid = await _login(client, factory, 5902)
    async with factory() as session:
        repo = UserRepository(session)
        entry = await repo.create_entry(user_id=other_uid, entry_date=date.today(), entry_type=EntryType.MEAL, title="Чужое", calories=10)
        other = await repo.create_favorite_from_entry(entry)
    invalid = [
        ({"favorite_ids": [original[0]] * 3, "original_ids": original}, 422),
        ({"favorite_ids": original[:-1], "original_ids": original}, 422),
        ({"favorite_ids": original[:-1], "original_ids": original[:-1]}, 409),
        ({"favorite_ids": [other.id, *original], "original_ids": [other.id, *original]}, 409),
        ({"favorite_ids": [], "original_ids": []}, 409),
        ({"favorite_ids": original}, 422),
        ({"favorite_ids": [True], "original_ids": [True]}, 422),
        ({"favorite_ids": [-1], "original_ids": [-1]}, 422),
    ]
    for body, status in invalid:
        result = await client.put("/v1/favorites/order", headers=headers, json=body)
        assert result.status_code == status, result.text
    assert (await client.put("/v1/favorites/order", json={"favorite_ids": original, "original_ids": original})).status_code == 401
    assert [item["id"] for item in (await client.get("/v1/favorites", headers=headers)).json()["favorites"]] == original
    result = await client.get("/v1/favorites", headers={"Authorization": f"Bearer {other_token}"})
    assert [item["id"] for item in result.json()["favorites"]] == [other.id]


def test_migration_preserves_old_order_with_timestamp_ties_and_supports_rollback():
    spec = importlib.util.spec_from_file_location("favorite_order_migration", Path(__file__).parents[1] / "migrations/versions/023_favorite_order.py")
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE favorite_meals (id INTEGER PRIMARY KEY, user_id INTEGER, created_at DATETIME)"))
        conn.execute(sa.text("INSERT INTO favorite_meals VALUES (1,1,'2026-01-01'), (2,1,'2026-01-02'), (3,1,'2026-01-02'), (4,2,'2026-01-01')"))
        migration.op = Operations(MigrationContext.configure(conn))
        for _ in range(2):
            migration.upgrade()
            assert conn.execute(sa.text("SELECT id, sort_order FROM favorite_meals ORDER BY user_id, sort_order")).all() == [(3, 0), (2, 1), (1, 2), (4, 0)]
            migration.downgrade()
            assert "sort_order" not in [column["name"] for column in sa.inspect(conn).get_columns("favorite_meals")]
    engine.dispose()
