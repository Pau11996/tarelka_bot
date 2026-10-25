"""Deliver persistent goal chat messages to Telegram without ephemeral cleanup."""
import asyncio
import logging

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from sqlalchemy import select

from src.db.models import AchievementMessage, User
from src.db.session import async_session_factory
from src.shared.weight_tracking import notification_channel

log = logging.getLogger(__name__)


async def deliver_goal_messages(bot, *, session_factory=None):
    factory = session_factory or async_session_factory
    sent = 0
    for _ in range(100):
        async with factory() as session:
            message = await session.scalar(
                select(AchievementMessage).where(AchievementMessage.telegram_status == "pending")
                .order_by(AchievementMessage.created_at, AchievementMessage.id)
                .limit(1).with_for_update(skip_locked=True)
            )
            if not message:
                break
            user = await session.get(User, message.user_id)
            channel, ready, _ = await notification_channel(session, user) if user else (None, False, None)
            if channel != "telegram" or not ready:
                message.telegram_status = "skipped"
                await session.commit()
                continue
            message_id, telegram_id = message.id, user.telegram_id
            text = f"⚖️ {message.title}\n\n{message.message}"
            # Claim before the network call: an unknown Telegram outcome must not
            # produce another congratulations after a process restart.
            message.telegram_status = "sending"
            await session.commit()
        try:
            await bot.send_message(telegram_id, text, reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="Задать новую цель", callback_data="ach:goal")],
                [InlineKeyboardButton(text="Вес и цель", callback_data="ach:home")],
            ]))
            status = "sent"
            sent += 1
        except Exception:
            status = "failed"
            log.exception("Goal congratulations delivery failed for message_id=%s", message_id)
        async with factory() as session:
            message = await session.get(AchievementMessage, message_id)
            if message:
                message.telegram_status = status
                await session.commit()
    return sent


async def run_goal_messages_loop(bot):
    while True:
        try:
            await deliver_goal_messages(bot)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Goal congratulations iteration failed")
        await asyncio.sleep(5)
