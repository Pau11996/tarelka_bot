from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone

from aiogram.types import Message

from src.bot.config import settings
from src.bot.keyboards.menus import subscription_keyboard
from src.bot.services.links import increase_limit_hint
from src.bot.services.messaging import answer_ephemeral
from src.bot.services.message_cleanup import MessageCleanupService
from src.bot.services.nutrition import local_today
from src.db.models import User
from src.db.repository import UserRepository


@dataclass(frozen=True)
class RequestGrant:
    source: str  # "daily" | "bonus"

    def __bool__(self) -> bool:
        return True


def has_active_subscription(user: User, *, now: datetime | None = None) -> bool:
    if user.subscription_until is None:
        return False
    current = now or datetime.now(timezone.utc)
    return user.subscription_until > current


def effective_daily_request_limit(user: User) -> int:
    if user.daily_request_limit is not None:
        return user.daily_request_limit
    if has_active_subscription(user):
        return settings.subscription_daily_request_limit
    return settings.daily_request_limit


def format_limit_reached_message(user: User) -> str:
    limit = effective_daily_request_limit(user)
    return f"Вы достигли дневного лимита запросов ({limit} в день).\n\n{increase_limit_hint()}"


def limit_welcome_note(user: User) -> str:
    limit = effective_daily_request_limit(user)
    bonus_requests = int(user.bonus_requests or 0)
    bonus_note = (
        f" Бонусных запросов: {bonus_requests}."
        if bonus_requests > 0
        else ""
    )
    return (
        f"\n\nДоступно {limit} запросов в день "
        f"(фото, текст, голос и исправления).{bonus_note}"
    )


async def try_consume_daily_request(repo: UserRepository, user: User, usage_date: date | None = None) -> bool:
    day = usage_date or local_today(user.timezone)
    limit = effective_daily_request_limit(user)
    return await repo.try_consume_daily_request(user.id, day, limit)


async def ensure_request_allowed(
    message: Message,
    repo: UserRepository,
    user: User,
    cleanup: MessageCleanupService,
    *,
    track_user: bool = False,
) -> RequestGrant | None:
    if await try_consume_daily_request(repo, user):
        return RequestGrant(source="daily")
    if await repo.try_consume_bonus_request(user.id):
        if (user.bonus_requests or 0) > 0:
            user.bonus_requests -= 1
        return RequestGrant(source="bonus")

    await answer_ephemeral(
        message,
        cleanup,
        format_limit_reached_message(user),
        reply_markup=subscription_keyboard(is_active=has_active_subscription(user)),
        track_user=track_user,
    )
    return None


async def refund_request(repo: UserRepository, user: User, grant: RequestGrant) -> None:
    if grant.source == "bonus":
        await repo.refund_bonus_request(user.id)
        user.bonus_requests = int(user.bonus_requests or 0) + 1
        return
    await repo.refund_daily_request(user.id, local_today(user.timezone))
