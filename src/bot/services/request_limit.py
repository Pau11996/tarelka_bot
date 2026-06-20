from __future__ import annotations

from datetime import date

from aiogram.types import Message

from src.bot.config import settings
from src.bot.services.links import feedback_chat_url
from src.bot.services.messaging import answer_ephemeral
from src.bot.services.message_cleanup import MessageCleanupService
from src.bot.services.nutrition import local_today
from src.db.models import User
from src.db.repository import UserRepository


def effective_daily_request_limit(user: User) -> int:
    if user.daily_request_limit is not None:
        return user.daily_request_limit
    return settings.daily_request_limit


def format_limit_reached_message(user: User) -> str:
    limit = effective_daily_request_limit(user)
    url = feedback_chat_url()
    if url:
        return (
            f"Вы достигли дневного лимита запросов ({limit} в день).\n\n"
            "Чтобы увеличить лимит, напишите в "
            f'<a href="{url}">чат поддержки</a> с просьбой добавить лимит.'
        )
    return f"Вы достигли дневного лимита запросов ({limit} в день)."


def limit_welcome_note(user: User) -> str:
    limit = effective_daily_request_limit(user)
    url = feedback_chat_url()
    if url:
        return (
            f"\n\nДоступно {limit} запросов в день "
            "(фото, текст и исправления). "
            "Чтобы увеличить лимит, напишите в "
            f'<a href="{url}">чат поддержки</a>.\n\n'
        )
    return f"\n\nДоступно {limit} запросов в день (фото, текст и исправления).\n\n"


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
) -> bool:
    if await try_consume_daily_request(repo, user):
        return True

    await answer_ephemeral(
        message,
        cleanup,
        format_limit_reached_message(user),
        track_user=track_user,
    )
    return False
