"""One calendar-week reminder event shared by Telegram and app deliveries."""
import asyncio
import logging
from datetime import date, datetime, timedelta, timezone

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from sqlalchemy import select

from src.db.models import User, WeighInReminder, WeightReminderEvent
from src.db.repository import UserRepository
from src.db.session import async_session_factory
from src.shared.notifications import notify_user
from src.shared.weight_tracking import (
    insert_once, lock_user, notification_channel, user_zone, weight_records,
)

log = logging.getLogger(__name__)
REMINDER_TEXT = "Пора записать вес. Обновим ваш прогресс?"


def reminder_keyboard():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Записать вес", callback_data="ach:weigh")],
        [InlineKeyboardButton(text="Отключить это напоминание", callback_data="ach:reminder_off")],
    ])


async def reminder_due(session, user, pref, now):
    local = now.astimezone(user_zone(user))
    if not pref or not pref.enabled or local.weekday() != pref.weekday or local.strftime("%H:%M") < pref.local_time:
        return None
    _, ready, _ = await notification_channel(session, user)
    if not ready:
        return None
    week = local.date() - timedelta(days=local.weekday())
    rows = await weight_records(session, user, now=now)
    weighed = any(date.fromisoformat(row["local_date"]) >= week for row in rows)
    return local.date(), week, weighed


async def reminder_delivery_valid(session, user, event_key, now):
    if not event_key.startswith("weigh:"):
        return True
    try:
        week = date.fromisoformat(event_key.split(":", 1)[1])
    except ValueError:
        return False
    event = await session.get(WeightReminderEvent, (user.id, week))
    pref = await session.get(WeighInReminder, user.id)
    due = await reminder_due(session, user, pref, now)
    return bool(event and due and due[0] == event.local_date and due[1] == week and not due[2])


async def run_weigh_reminders_iteration(bot, *, now=None, session_factory=None):
    current = now or datetime.now(timezone.utc)
    factory = session_factory or async_session_factory
    async with factory() as session:
        ids = (await session.scalars(select(WeighInReminder.user_id).where(WeighInReminder.enabled.is_(True)))).all()
    sent = 0
    for user_id in ids:
        async with factory() as session:
            await lock_user(session, user_id)
            user = await session.get(User, user_id)
            pref = await session.get(WeighInReminder, user_id)
            if not user:
                continue
            due = await reminder_due(session, user, pref, current)
            if not due:
                continue
            local_day, week, weighed = due
            inserted = await insert_once(session, WeightReminderEvent,
                dict(user_id=user.id, week_start=week, local_date=local_day,
                     status="skipped" if weighed else "pending", created_at=current), ["user_id", "week_start"])
            await session.commit()
            if not inserted or weighed:
                continue
            event_key = f"weigh:{week.isoformat()}"
            await lock_user(session, user_id)
            await session.refresh(user)
            await session.refresh(pref)
            event = await session.get(WeightReminderEvent, (user_id, week))
            if not await reminder_delivery_valid(session, user, event_key, current):
                event.status = "cancelled"
                await session.commit()
                continue
            try:
                # The persistent message and its buttons bypass ephemeral-message cleanup.
                await notify_user(bot, UserRepository(session), user, REMINDER_TEXT,
                                  event_key=event_key, path="/weight", reply_markup=reminder_keyboard())
                channel, _, _ = await notification_channel(session, user)
                event.status = "sent" if channel == "telegram" else "queued"
                sent += 1
            except Exception:
                # An unknown Telegram outcome is not resent, preventing duplicate weekly messages.
                event.status = "failed"
                log.exception("Weight reminder delivery failed for user_id=%s", user_id)
            await session.commit()
    return sent


async def run_weigh_reminders_loop(bot):
    while True:
        try:
            await run_weigh_reminders_iteration(bot)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Weight reminder iteration failed")
        await asyncio.sleep(60)
