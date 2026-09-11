import asyncio
from unittest.mock import AsyncMock

import pytest

from src.bot.services.message_cleanup import MessageCleanupService


@pytest.mark.asyncio
async def test_message_cleanup_deletes_after_ttl() -> None:
    bot = AsyncMock()
    service = MessageCleanupService(ttl_seconds=1)

    service.schedule(bot, chat_id=123, message_id=456)
    await asyncio.sleep(1.1)

    bot.delete_message.assert_awaited_once_with(chat_id=123, message_id=456)


@pytest.mark.asyncio
async def test_message_cleanup_ignores_delete_errors() -> None:
    bot = AsyncMock()
    bot.delete_message.side_effect = Exception("gone")
    service = MessageCleanupService(ttl_seconds=0)

    service.schedule(bot, chat_id=123, message_id=456)
    await asyncio.sleep(0.05)

    bot.delete_message.assert_awaited_once()


@pytest.mark.asyncio
async def test_answer_persistent_with_menu_drops_cached_keyboard() -> None:
    from aiogram.types import ReplyKeyboardRemove

    from src.bot.services.messaging import answer_persistent_with_menu

    removed = AsyncMock()
    sent = AsyncMock()
    sent.chat.id = 123
    sent.message_id = 77
    message = AsyncMock()
    message.answer = AsyncMock(side_effect=[removed, sent])
    cleanup = MessageCleanupService(ttl_seconds=60)

    result = await answer_persistent_with_menu(message, "hello", cleanup=cleanup)

    assert result is sent
    assert isinstance(message.answer.await_args_list[0].kwargs["reply_markup"], ReplyKeyboardRemove)
    assert message.answer.await_args_list[1].args[0] == "hello"
    assert isinstance(message.answer.await_args_list[1].kwargs["reply_markup"], ReplyKeyboardRemove)
    removed.delete.assert_awaited_once()


@pytest.mark.asyncio
async def test_answer_ephemeral_schedules_bot_message() -> None:
    from src.bot.services.messaging import answer_ephemeral

    sent = AsyncMock()
    sent.chat.id = 55
    sent.message_id = 88
    message = AsyncMock()
    message.chat.id = 55
    message.message_id = 10
    message.bot = AsyncMock()
    message.answer = AsyncMock(return_value=sent)
    cleanup = MessageCleanupService(ttl_seconds=60)

    result = await answer_ephemeral(message, cleanup, "today")

    assert result is sent
    assert len(cleanup._tasks) == 2
