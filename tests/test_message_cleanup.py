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
async def test_message_cleanup_skips_menu_anchor_message() -> None:
    bot = AsyncMock()
    service = MessageCleanupService(ttl_seconds=0)
    service.remember_menu_message(chat_id=123, message_id=456)

    service.schedule(bot, chat_id=123, message_id=456)
    await asyncio.sleep(0.05)

    bot.delete_message.assert_not_awaited()


@pytest.mark.asyncio
async def test_message_cleanup_refreshes_menu_after_ephemeral_delete() -> None:
    bot = AsyncMock()
    sent = AsyncMock()
    sent.message_id = 999
    bot.send_message.return_value = sent
    service = MessageCleanupService(ttl_seconds=0)

    service.schedule(bot, chat_id=123, message_id=456)
    await asyncio.sleep(0.2)

    bot.delete_message.assert_awaited_once_with(chat_id=123, message_id=456)
    bot.send_message.assert_awaited_once()
    assert service._menu_message_ids[123] == 999


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
    removed.delete.assert_awaited_once()
    assert cleanup._menu_message_ids[123] == 77
