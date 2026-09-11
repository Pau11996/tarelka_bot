from __future__ import annotations

import asyncio
import logging

from aiogram import Bot

logger = logging.getLogger(__name__)


class MessageCleanupService:
    def __init__(self, ttl_seconds: int) -> None:
        self.ttl_seconds = ttl_seconds
        self._tasks: set[asyncio.Task[None]] = set()

    def schedule(self, bot: Bot, chat_id: int, message_id: int) -> None:
        task = asyncio.create_task(self._delete_later(bot, chat_id, message_id))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _delete_later(self, bot: Bot, chat_id: int, message_id: int) -> None:
        await asyncio.sleep(self.ttl_seconds)
        try:
            await bot.delete_message(chat_id=chat_id, message_id=message_id)
        except Exception:
            logger.debug(
                "Could not delete message chat_id=%s message_id=%s",
                chat_id,
                message_id,
                exc_info=True,
            )
