from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from aiogram import Bot

from src.bot.config import settings
from src.bot.keyboards.menus import subscription_keyboard
from src.bot.services.links import subscription_offer_link
from src.db.repository import UserRepository
from src.db.session import async_session_factory

logger = logging.getLogger(__name__)


async def run_subscription_reminder_loop(bot: Bot) -> None:
    interval = settings.subscription_reminder_interval_seconds
    window = timedelta(days=settings.subscription_reminder_days_before)

    while True:
        try:
            now = datetime.now(timezone.utc)
            async with async_session_factory() as session:
                repo = UserRepository(session)
                users = await repo.get_users_needing_renewal_reminder(now=now, window=window)
                for user in users:
                    try:
                        until = user.subscription_until.astimezone(timezone.utc).strftime("%d.%m.%Y")
                        offer = subscription_offer_link(renew=True)
                        if offer:
                            text = f"Подписка истекает {until}. {offer.capitalize()}?"
                        else:
                            text = f"Подписка истекает {until}. Продлить?"
                        await bot.send_message(
                            user.telegram_id,
                            text,
                            reply_markup=subscription_keyboard(is_active=True),
                        )
                        await repo.mark_renewal_reminded(user)
                    except Exception:
                        logger.exception(
                            "Failed to send subscription reminder to user_id=%s",
                            user.id,
                        )
        except Exception:
            logger.exception("Subscription reminder loop iteration failed")

        await asyncio.sleep(interval)
