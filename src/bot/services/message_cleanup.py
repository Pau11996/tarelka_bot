from __future__ import annotations

import asyncio
import logging

from aiogram import Bot

from src.bot.keyboards.menus import MAIN_MENU_ANCHOR, main_menu

logger = logging.getLogger(__name__)


class MessageCleanupService:
    def __init__(self, ttl_seconds: int) -> None:
        self.ttl_seconds = ttl_seconds
        self._tasks: set[asyncio.Task[None]] = set()
        self._menu_message_ids: dict[int, int] = {}

    def remember_menu_message(self, chat_id: int, message_id: int) -> None:
        self._menu_message_ids[chat_id] = message_id

    def schedule(self, bot: Bot, chat_id: int, message_id: int) -> None:
        if self._menu_message_ids.get(chat_id) == message_id:
            return
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
            return

        if self._menu_message_ids.get(chat_id) == message_id:
            self._menu_message_ids.pop(chat_id, None)

        await self._ensure_main_menu(bot, chat_id)

    async def _ensure_main_menu(self, bot: Bot, chat_id: int) -> None:
        if chat_id in self._menu_message_ids:
            return
        try:
            sent = await bot.send_message(chat_id, MAIN_MENU_ANCHOR, reply_markup=main_menu())
            self._menu_message_ids[chat_id] = sent.message_id
        except Exception:
            logger.debug("Could not refresh main menu for chat_id=%s", chat_id, exc_info=True)
