from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.db.models import Base, DailyUserActivity, DayEntry, EntryType, User, WeightHistory
from src.shared.activity import count_meal_active_users

NOW = datetime(2026, 10, 25, 12, tzinfo=timezone.utc)
START = NOW.replace(hour=0)


@pytest.fixture
async def activity_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


def meal(user_id, *, created_at=NOW, entry_date=None, entry_type=EntryType.MEAL):
    return DayEntry(user_id=user_id, entry_type=entry_type,
                    entry_date=entry_date or created_at.date(), created_at=created_at,
                    title="Fixture", calories=100)


async def test_menu_history_water_activity_and_weight_do_not_make_user_active(activity_session):
    session = activity_session
    user = User(telegram_id=9001, timezone="Europe/Minsk")
    session.add(user)
    await session.flush()
    session.add_all([
        DailyUserActivity(user_id=user.id, activity_date=NOW.date()),
        meal(user.id, entry_type=EntryType.WATER),
        meal(user.id, entry_type=EntryType.ACTIVITY),
        WeightHistory(user_id=user.id, weight_kg=75, recorded_at=NOW),
    ])
    await session.commit()
    assert await count_meal_active_users(session, start_at=START, end_at=NOW) == 0


async def test_counts_unique_meal_users_from_bot_and_email_app_within_period(activity_session):
    session = activity_session
    users = [User(telegram_id=9002),
             User(email="activity@example.test", password_hash="fixture"),
             User(telegram_id=9003), User(telegram_id=9004)]
    session.add_all(users)
    await session.flush()
    session.add_all([
        meal(users[0].id), meal(users[0].id),
        meal(users[1].id, created_at=START),
        meal(users[2].id, created_at=START - timedelta(seconds=1)),
        meal(users[3].id, created_at=NOW + timedelta(seconds=1)),
    ])
    await session.commit()
    assert await count_meal_active_users(session, start_at=START, end_at=NOW) == 2


async def test_backdated_diary_entry_counts_on_its_save_day(activity_session):
    session = activity_session
    user = User(telegram_id=9005)
    session.add(user)
    await session.flush()
    session.add(meal(user.id, entry_date=date(2026, 10, 10)))
    await session.commit()
    assert await count_meal_active_users(session, start_at=START, end_at=NOW) == 1


async def test_deleted_or_rolled_back_meals_do_not_leave_stale_activity(activity_session):
    session = activity_session
    user = User(telegram_id=9006)
    session.add(user)
    await session.commit()
    user_id = user.id
    entry = meal(user_id)
    session.add(entry)
    await session.commit()
    assert await count_meal_active_users(session, start_at=START, end_at=NOW) == 1
    await session.delete(entry)
    await session.commit()
    assert await count_meal_active_users(session, start_at=START, end_at=NOW) == 0
    session.add(meal(user_id))
    await session.flush()
    await session.rollback()
    assert await count_meal_active_users(session, start_at=START, end_at=NOW) == 0
