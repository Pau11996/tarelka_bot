import logging
from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware, Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.fsm.storage.memory import MemoryStorage
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.bot.config import settings
from src.bot.handlers import correction, daily, favorites, feedback, food, profile, start, statistics
from src.bot.services.message_cleanup import MessageCleanupService
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
    dp.include_router(feedback.router)
    dp.include_router(daily.router)
    dp.include_router(statistics.router)
    dp.include_router(favorites.router)
    dp.include_router(correction.router)
    dp.include_router(food.router)

    return dp


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    if not settings.telegram_bot_token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is required")
    bot = Bot(
        token=settings.telegram_bot_token,
        default=DefaultBotProperties(parse_mode="HTML"),
    )
    dp = await create_dispatcher()
    logger.info("Starting ТАРЕЛКА bot (message cleanup TTL: %ss)", settings.message_cleanup_ttl_seconds)
    await dp.start_polling(bot)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
