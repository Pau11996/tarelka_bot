import asyncio
import logging
from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware, Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import BotCommand, MenuButtonCommands
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.bot.config import settings
from src.shared.logging_config import setup_logging
from src.bot.handlers import (
    correction,
    daily,
    data_management,
    favorites,
    feedback,
    food,
    profile,
    referrals,
    start,
    statistics,
    subscription,
    survey,
)
from src.bot.services.links import MENU_COMMANDS
from src.bot.services.message_cleanup import MessageCleanupService
from src.bot.services.diary_nudges import run_diary_nudges_loop
from src.bot.services.subscription_reminder import run_subscription_reminder_loop
from src.db.repository import UserRepository
from src.db.session import async_session_factory

logger = logging.getLogger(__name__)


class DbSessionMiddleware(BaseMiddleware):
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self.session_factory = session_factory

    async def __call__(
        self,
        handler: Callable[[Any, dict[str, Any]], Awaitable[Any]],
        event: Any,
        data: dict[str, Any],
    ) -> Any:
        async with self.session_factory() as session:
            data["session"] = session
            telegram_user = data.get("event_from_user")
            if telegram_user is not None and not telegram_user.is_bot:
                repo = UserRepository(session)
                await repo.record_user_activity(
                    telegram_user.id,
                    settings.default_timezone,
                )
            return await handler(event, data)


class CleanupMiddleware(BaseMiddleware):
    def __init__(self, cleanup: MessageCleanupService) -> None:
        self.cleanup = cleanup

    async def __call__(
        self,
        handler: Callable[[Any, dict[str, Any]], Awaitable[Any]],
        event: Any,
        data: dict[str, Any],
    ) -> Any:
        data["cleanup"] = self.cleanup
        return await handler(event, data)


async def create_dispatcher() -> Dispatcher:
    dp = Dispatcher(storage=MemoryStorage())
    cleanup = MessageCleanupService(ttl_seconds=settings.message_cleanup_ttl_seconds)
    dp.update.middleware(CleanupMiddleware(cleanup))
    dp.update.middleware(DbSessionMiddleware(async_session_factory))

    dp.include_router(start.router)
    dp.include_router(profile.router)
    dp.include_router(subscription.router)
    dp.include_router(data_management.router)
    dp.include_router(referrals.router)
    dp.include_router(feedback.router)
    dp.include_router(survey.router)
    dp.include_router(daily.router)
    dp.include_router(statistics.router)
    dp.include_router(favorites.router)
    dp.include_router(correction.router)
    dp.include_router(food.router)

    return dp


async def main() -> None:
    setup_logging("bot")
    if not settings.telegram_bot_token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is required")
    bot = Bot(
        token=settings.telegram_bot_token,
        default=DefaultBotProperties(parse_mode="HTML"),
    )
    dp = await create_dispatcher()
    await bot.set_my_commands(
        [BotCommand(command=name, description=description) for name, description in MENU_COMMANDS]
    )
    await bot.set_chat_menu_button(menu_button=MenuButtonCommands())
    logger.info("Starting ТАРЕЛКА bot (message cleanup TTL: %ss)", settings.message_cleanup_ttl_seconds)
    asyncio.create_task(run_subscription_reminder_loop(bot))
    if settings.diary_nudges_enabled:
        asyncio.create_task(run_diary_nudges_loop(bot))
    await dp.start_polling(bot)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
