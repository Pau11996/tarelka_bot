from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from aiogram import Bot
from aiogram.exceptions import TelegramForbiddenError

from src.bot.config import settings
from src.db.repository import UserRepository
from src.db.session import async_session_factory

logger = logging.getLogger(__name__)

REENGAGEMENT_TEXT = (
    "Давно не было записей в дневнике ТАРЕЛКИ.\n\n"
    "Отправьте фото, голосовое или описание следующего приёма пищи — "
    "бот обновит дневной баланс.\n\n"
    "Отключить такие напоминания: /notifications_off"
)


async def run_reengagement_iteration(
    bot: Bot,
    *,
    now: datetime | None = None,
) -> int:
    current = now or datetime.now(timezone.utc)
    sent = 0
    async with async_session_factory() as session:
        repo = UserRepository(session)
        users = await repo.get_users_needing_reengagement(
            now=current,
            inactivity_days=settings.reengagement_inactivity_days,
        )
        for user in users:
            try:
                # Claim this inactivity period before sending so a restart cannot
                # deliver the same reminder twice.
                await repo.mark_reengagement_sent(user, now=current)
                await bot.send_message(user.telegram_id, REENGAGEMENT_TEXT)
                sent += 1
            except TelegramForbiddenError:
                await repo.set_notifications_enabled(user, False)
            except Exception:
                logger.exception(
                    "Failed to send reengagement reminder to user_id=%s",
                    user.id,
                )
            await asyncio.sleep(0.05)
    return sent


async def run_reengagement_loop(bot: Bot) -> None:
    interval = max(60, settings.reengagement_interval_seconds)
    while True:
        try:
            await run_reengagement_iteration(bot)
        except Exception:
            logger.exception("Reengagement reminder loop iteration failed")
        await asyncio.sleep(interval)
