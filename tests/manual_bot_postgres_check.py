"""Run explicitly against local PostgreSQL; create and always drop an isolated DB."""
import asyncio
from datetime import date, datetime, timedelta, timezone
import os
from pathlib import Path
import subprocess
from uuid import uuid4

from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.bot.config import settings
from src.db.models import AchievementMessage, AIAnalysis, AnalysisType, DailyUserActivity, DayEntry, EntryType, FavoriteMeal, Payment, User, WeightHistory
from src.db.repository import UserRepository
from src.shared.weight_tracking import active_goal, record_weight, set_weight_goal
from src.ai_analyzer.admin import collect_admin_stats


async def check_meal_activity(factory):
    now = datetime(2026, 10, 25, 12, tzinfo=timezone.utc)
    signup = datetime(2026, 10, 18, 21, 30, tzinfo=timezone.utc)
    day1 = datetime(2026, 10, 19, 21, 15, tzinfo=timezone.utc)
    day7 = datetime(2026, 10, 24, 21, 15, tzinfo=timezone.utc)
    async with factory() as session:
        users = [User(telegram_id=798800000 + n, timezone="Europe/Minsk",
                      acquisition_source="meal-activity-check", created_at=signup)
                 for n in range(5)]
        app_user = User(email="activity@example.test", password_hash="fixture",
                        timezone="Europe/Minsk", created_at=signup)
        session.add_all([*users, app_user])
        await session.flush()
        click, meal_user, water, old, future = users
        for user in [click, meal_user, water, future]:
            session.add(AIAnalysis(user_id=user.id, analysis_type=AnalysisType.FOOD_TEXT,
                                   created_at=signup + timedelta(hours=1)))
        for user in [click, water]:
            for day in [date(2026, 10, 20), date(2026, 10, 25)]:
                session.add(DailyUserActivity(user_id=user.id, activity_date=day))
        for user, kind, created_at in [
            (meal_user, EntryType.MEAL, day1), (meal_user, EntryType.MEAL, day7),
            (meal_user, EntryType.MEAL, day7), (water, EntryType.WATER, day1),
            (water, EntryType.ACTIVITY, day7),
            (old, EntryType.MEAL, now - timedelta(days=30)),
            (future, EntryType.MEAL, now + timedelta(hours=1)),
            (app_user, EntryType.MEAL, now - timedelta(hours=1)),
        ]:
            session.add(DayEntry(user_id=user.id, entry_type=kind, title="Fixture",
                                 calories=100, entry_date=date(2026, 9, 1), created_at=created_at))
        await session.commit()
        stats = await collect_admin_stats(session, days=8, now=now)
        assert stats.totals.active_users == 2, stats.totals.active_users
        source = next(row for row in stats.sources if row.source == "meal-activity-check")
        assert source.d1_users == 1 and source.d7_users == 1, (source.d1_users, source.d7_users)
    print("Meal-based activity and local-day retention ignore legacy menu clicks: OK", flush=True)


async def check_operations(url):
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with factory() as session:
            repo = UserRepository(session)
            user = await repo.get_or_create_user(799999999, "Europe/Minsk")
            uid = user.id
            await repo.ensure_default_profile(uid)
            await repo.upsert_profile(uid, weight_kg=80, daily_calorie_target=2100)
            await set_weight_goal(session, user, 75)
            for _ in range(2):
                await record_weight(session, user, 75, operation_key="release:manual")
            assert await active_goal(session, uid) is None
            assert await session.scalar(select(func.count()).select_from(WeightHistory)) == 2
            assert await session.scalar(select(func.count()).select_from(AchievementMessage)) == 1
            for _ in range(2):
                await repo.activate_subscription(user, duration_days=30, charge_id="release:payment", stars_amount=150)
            assert await session.scalar(select(func.count()).select_from(Payment)) == 1
            entry = await repo.create_entry(user_id=uid, entry_date=date.today(), entry_type=EntryType.MEAL,
                                           title="Release fixture", calories=300)
            entry_id = entry.id
        print("Weight, goal completion, congratulations and payment replay: OK", flush=True)

        ready = 0
        start = asyncio.Event()

        async def consume():
            nonlocal ready
            async with factory() as session:
                # Open all connections before starting the first usage-row inserts.
                await session.connection()
                ready += 1
                if ready == 3:
                    start.set()
                await start.wait()
                return await UserRepository(session).try_consume_daily_request(
                    uid, date.today(), kind="photo", limit=2, shared=False)

        results = await asyncio.gather(*(consume() for _ in range(3)), return_exceptions=True)
        assert all(isinstance(value, bool) for value in results), [type(value).__name__ for value in results]
        assert results.count(True) == 2 and results.count(False) == 1, results
        print("Concurrent first-day requests respect the quota: OK", flush=True)

        async def favorite():
            async with factory() as session:
                entry = await session.get(DayEntry, entry_id)
                return (await UserRepository(session).create_favorite_from_entry(entry)).id

        results = await asyncio.gather(favorite(), favorite(), return_exceptions=True)
        assert all(isinstance(value, int) for value in results), [type(value).__name__ for value in results]
        assert results[0] == results[1], results
        print("Concurrent favorite clicks save one item: OK", flush=True)
        async with factory() as session:
            assert await session.scalar(select(func.count()).select_from(FavoriteMeal)) == 1
            repo = UserRepository(session)
            await repo.delete_user(await session.get(User, uid))
            for model in [User, WeightHistory, DayEntry, FavoriteMeal, Payment, AchievementMessage]:
                assert await session.scalar(select(func.count()).select_from(model)) == 0, model.__name__
        print("Account deletion removes associated data: OK", flush=True)
        await check_meal_activity(factory)
    finally:
        await engine.dispose()


async def main():
    url = make_url(settings.database_url)
    assert url.get_backend_name() == "postgresql" and url.host in {"postgres", "localhost", "127.0.0.1"}, "Use local PostgreSQL only"
    # The local Compose override publishes PostgreSQL only on loopback.
    url = url.set(host="127.0.0.1", port=5432)
    name = "wellhealth_release_" + uuid4().hex[:10]
    admin = create_async_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    created = False
    try:
        async with admin.connect() as connection:
            await connection.execute(text(f"CREATE DATABASE {name}"))
        created = True
        target = url.set(database=name)
        env = {**os.environ, "DATABASE_URL": target.render_as_string(hide_password=False)}
        # Run the same migrations and metadata check used for a deployment.
        alembic = str(Path(__file__).resolve().parents[1] / ".venv/bin/alembic")
        subprocess.run([alembic, "upgrade", "head"], env=env, check=True)
        subprocess.run([alembic, "check"], env=env, check=True)
        await check_operations(target)
    finally:
        if created:
            async with admin.connect() as connection:
                await connection.execute(text(f"DROP DATABASE {name} WITH (FORCE)"))
            print("Isolated release-check database removed.", flush=True)
        await admin.dispose()


if __name__ == "__main__":
    asyncio.run(main())
