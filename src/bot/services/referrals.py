from __future__ import annotations

import logging
from datetime import datetime, timezone

from aiogram import Bot

from src.bot.config import settings
from src.db.models import User
from src.db.repository import ReferralGrant, UserRepository

logger = logging.getLogger(__name__)


def friends_phrase(count: int) -> str:
    mod10 = count % 10
    mod100 = count % 100
    if mod10 == 1 and mod100 != 11:
        word = "друг"
    elif mod10 in {2, 3, 4} and mod100 not in {12, 13, 14}:
        word = "друга"
    else:
        word = "друзей"
    return f"{count} {word}"


def format_referral_reward_notice(grant: ReferralGrant) -> str:
    if grant.granted:
        until = _subscription_until_label(grant.referrer)
        return (
            f"В этом месяце {friends_phrase(grant.goal)} сделали первый анализ.\n\n"
            f"Подписка активна до {until}."
        )
    if grant.already_rewarded:
        return (
            "Ваш приглашённый пользователь отправил первый анализ.\n\n"
            "Подписка за этот месяц уже начислена. "
            "В новом месяце счётчик начнётся с нуля."
        )
    remaining = max(0, grant.goal - grant.progress)
    return (
        "Ваш приглашённый пользователь отправил первый анализ.\n\n"
        f"В этом месяце: {grant.progress} из {grant.goal}. "
        f"Ещё {friends_phrase(remaining)} — и подписка на месяц."
    )


def format_invite_text(*, url: str, progress: int, goal: int, rewarded: bool) -> str:
    if rewarded:
        status = (
            f"В этом месяце: {progress} из {goal}. "
            "Подписка за этот месяц уже начислена."
        )
    else:
        status = f"В этом месяце: {progress} из {goal}."
    return (
        "Пригласите друга в ТАРЕЛКУ.\n\n"
        "Когда он заполнит профиль и отправит первый AI-анализ, он засчитается.\n"
        f"{friends_phrase(goal)} за календарный месяц — подписка на месяц.\n"
        f"{status}\n\n"
        f"{url}"
    )


def _subscription_until_label(user: User) -> str:
    until = user.subscription_until
    if until is None:
        return ""
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    return until.astimezone(timezone.utc).strftime("%d.%m.%Y")


async def reward_referrer_after_first_analysis(
    bot: Bot,
    repo: UserRepository,
    *,
    referred_user_id: int,
) -> bool:
    grant = await repo.grant_referral_reward(
        referred_user_id,
        monthly_goal=settings.referral_monthly_goal,
        duration_days=settings.subscription_duration_days,
    )
    if grant is None:
        return False

    try:
        if grant.referrer.telegram_id is None:
            from src.shared.notifications import notify_user

            await notify_user(
                bot, repo, grant.referrer, format_referral_reward_notice(grant),
                event_key=f"referral:{referred_user_id}:{grant.progress}",
            )
        else:
            await bot.send_message(grant.referrer.telegram_id, format_referral_reward_notice(grant))
    except Exception:
        logger.exception(
            "Failed to notify referrer user_id=%s about reward",
            grant.referrer.id,
        )
    return True
