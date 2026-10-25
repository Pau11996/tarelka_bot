"""Isolated visual QA server with a live analysis worker and disposable DATABASE_URL.
DATABASE_URL=sqlite+aiosqlite:////tmp/tarelka-visual-preview.sqlite \
AI_ANALYZER_URL=http://127.0.0.1:8000 \
python -m uvicorn manual_mobile_preview:app --app-dir tests --host 127.0.0.1 --port 8012
Set PREVIEW_PUBLIC_API_URL to the computer's LAN URL when opening on a phone.
"""

import asyncio
import os

if not os.environ.get("DATABASE_URL", "").startswith(
    "sqlite+aiosqlite:////tmp/tarelka-visual-"
):
    raise RuntimeError(
        "Visual QA requires a disposable /tmp/tarelka-visual-* SQLite database"
    )
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timedelta, timezone
from fastapi import FastAPI, Form
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from src.db.models import Base, User, EntryType, Sex, Goal, ActivityLevel, WeightHistory
from src.db.repository import UserRepository
from src.db.session import engine, async_session_factory
from src.mobile_api.routes import router
from src.mobile_api.experience import router as experience_router
from src.bot.services.coach import calendar_week_start
from src.mobile_api.worker import run_worker


@asynccontextmanager
async def lifespan(app):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session_factory() as session:
        repo = UserRepository(session)
        user = await repo.get_or_create_user(-990001, "Europe/Minsk")
        user.subscription_until = datetime.now(timezone.utc) + timedelta(days=30)
        user.notifications_enabled = False
        await session.commit()
        profile = await repo.ensure_default_profile(user.id)
        profile.weight_kg = 72
        profile.height_cm = 174
        profile.age = 31
        profile.sex = Sex.FEMALE
        profile.goal = Goal.MAINTAIN
        profile.activity_level = ActivityLevel.MODERATE
        profile.daily_calorie_target = 2100
        await session.commit()
        if not await repo.get_entries_for_date(
            user.id, datetime.now(timezone.utc).date()
        ):
            today = datetime.now(timezone.utc).date()
            for offset in range(30):
                day = today - timedelta(days=offset)
                if offset in (4, 12, 19):
                    continue
                for title, slot, cal in [
                    ("Овсянка с ягодами", "breakfast", 420),
                    ("Рис с курицей и овощами", "lunch", 670),
                    ("Рыба с картофелем", "dinner", 560),
                ]:
                    await repo.create_entry(
                        user_id=user.id,
                        entry_date=day,
                        entry_type=EntryType.MEAL,
                        title=title,
                        meal_slot=slot,
                        calories=cal + (offset % 4) * 25,
                        protein_g=25,
                        fat_g=18,
                        carbs_g=65,
                        micronutrients={"fiber_g": 6, "sugar_g": 8},
                    )
                await repo.create_entry(
                    user_id=user.id,
                    entry_date=day,
                    entry_type=EntryType.WATER,
                    title="Вода",
                    calories=0,
                    volume_ml=1200 + (offset % 3) * 250,
                )
                if offset % 2 == 0:
                    await repo.create_entry(
                        user_id=user.id,
                        entry_date=day,
                        entry_type=EntryType.ACTIVITY,
                        title="Прогулка",
                        calories=160,
                        duration_minutes=35,
                    )
            await repo.save_coach_review(
                user_id=user.id,
                week_start=calendar_week_start(today),
                facts={
                    "period": {
                        "start": (today - timedelta(days=6)).isoformat(),
                        "end": today.isoformat(),
                    }
                },
                review_text="<b>Ваша неделя</b>\nЕсть записи за 6 дней.\n\n<b>Что получилось</b>\nВ дневнике есть несколько вариантов завтрака и привычные обеды.\n\n<b>На следующую неделю</b>\nСохраните удобный вариант завтрака в избранном.",
                refresh_used=False,
            )
            entries = await repo.get_entries_for_date(user.id, today)
            await repo.create_favorite_from_entry(entries[0])
            for n in (0, 3, 9, 16, 27):
                session.add(
                    WeightHistory(
                        user_id=user.id,
                        weight_kg=72 + n * 0.025,
                        recorded_at=datetime.now(timezone.utc) - timedelta(days=n),
                    )
                )
            await session.commit()
    task = asyncio.create_task(run_worker())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:8083", "http://localhost:8083", "http://127.0.0.1:8084", "http://localhost:8084"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/v1/auth/telegram/start")
async def start():
    async with async_session_factory() as session:
        challenge = await UserRepository(session).create_mobile_login(ttl_seconds=600)
        return {
            "expires_in": 600,
            "code": challenge.id,
            "bot_url": f"{os.environ.get('PREVIEW_PUBLIC_API_URL', 'http://127.0.0.1:8012').rstrip('/')}/confirm?code={challenge.id}",
        }


@app.get("/confirm", response_class=HTMLResponse)
async def confirm_page(code: str):
    # Local test identity provider: no external account or credentials involved.
    async with async_session_factory() as session:
        user = await session.scalar(select(User).where(User.telegram_id == -990001))
        await UserRepository(session).attach_mobile_login(code, user.id)
    from html import escape

    return f'<h1>Тестовый дневник</h1><p>Синтетические данные. Реальный Telegram не используется.</p><form method="post"><input type="hidden" name="code" value="{escape(code, quote=True)}"><button>Войти в тестовый дневник</button></form>'


@app.post("/confirm", response_class=HTMLResponse)
async def confirm(code: str = Form(...)):
    async with async_session_factory() as session:
        user = await session.scalar(select(User).where(User.telegram_id == -990001))
        await UserRepository(session).attach_mobile_login(code, user.id)
    return "<h1>Вход подтверждён</h1><p>Вернитесь во вкладку приложения.</p>"


app.include_router(router, prefix="/v1")
app.include_router(experience_router, prefix="/v1")
