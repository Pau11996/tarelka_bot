from __future__ import annotations

import logging

from aiogram import Bot

from src.bot.config import settings
from src.db.repository import UserRepository

logger = logging.getLogger(__name__)


async def reward_referrer_after_first_analysis(
    bot: Bot,
    repo: UserRepository,
    *,
    referred_user_id: int,
) -> bool:
    referrer = await repo.grant_referral_reward(
        referred_user_id,
        bonus_requests=settings.referral_bonus_requests,
    )
    if referrer is None:
        return False

    try:
        await bot.send_message(
            referrer.telegram_id,
            "Ваш приглашённый пользователь отправил первый анализ.\n\n"
            f"Начислено {settings.referral_bonus_requests} бонусных AI-запроса. "
            f"Остаток: {referrer.bonus_requests}.",
        )
    except Exception:
        logger.exception(
            "Failed to notify referrer user_id=%s about reward",
            referrer.id,
        )
    return True
