from __future__ import annotations

from aiogram.types import CallbackQuery, Message, ReplyKeyboardRemove

from src.bot.services.message_cleanup import MessageCleanupService


def schedule_message(
    cleanup: MessageCleanupService,
    bot,
    chat_id: int,
    message_id: int,
    *,
    persistent: bool = False,
) -> None:
    if not persistent:
        cleanup.schedule(bot, chat_id, message_id)


def schedule_user_message(
    cleanup: MessageCleanupService,
    message: Message,
    *,
    persistent: bool = False,
) -> None:
    schedule_message(
        cleanup,
        message.bot,
        message.chat.id,
        message.message_id,
        persistent=persistent,
    )


def schedule_bot_message(
    cleanup: MessageCleanupService,
    message: Message,
    *,
    persistent: bool = False,
) -> None:
    schedule_message(
        cleanup,
        message.bot,
        message.chat.id,
        message.message_id,
        persistent=persistent,
    )


async def answer_ephemeral(
    message: Message,
    cleanup: MessageCleanupService,
    text: str,
    *,
    track_user: bool = True,
    **kwargs,
) -> Message:
    if track_user:
        schedule_user_message(cleanup, message)
    sent = await message.answer(text, **kwargs)
    schedule_bot_message(cleanup, sent)
    return sent


async def drop_cached_reply_keyboard(message: Message) -> Message:
    """Telegram often keeps an old persistent keyboard until it is explicitly removed."""
    return await message.answer("\u2060", reply_markup=ReplyKeyboardRemove())


async def answer_persistent(
    message: Message,
    text: str,
    *,
    cleanup: MessageCleanupService | None = None,
    **kwargs,
) -> Message:
    return await message.answer(text, **kwargs)


async def answer_persistent_with_menu(
    message: Message,
    text: str,
    *,
    cleanup: MessageCleanupService | None = None,
    **kwargs,
) -> Message:
    """Send a persistent reply and drop any cached ReplyKeyboard from older clients."""
    removed = await drop_cached_reply_keyboard(message)
    try:
        kwargs.setdefault("reply_markup", ReplyKeyboardRemove())
        return await answer_persistent(message, text, cleanup=cleanup, **kwargs)
    finally:
        try:
            await removed.delete()
        except Exception:
            pass


async def answer_photo_ephemeral(
    message: Message,
    cleanup: MessageCleanupService,
    *,
    track_user: bool = True,
    **kwargs,
) -> Message:
    if track_user:
        schedule_user_message(cleanup, message)
    sent = await message.answer_photo(**kwargs)
    schedule_bot_message(cleanup, sent)
    return sent


async def answer_photo_persistent(message: Message, **kwargs) -> Message:
    return await message.answer_photo(**kwargs)


async def edit_ephemeral(
    callback: CallbackQuery,
    cleanup: MessageCleanupService,
    text: str,
    **kwargs,
) -> None:
    await callback.message.edit_text(text, **kwargs)
    schedule_message(
        cleanup,
        callback.bot,
        callback.message.chat.id,
        callback.message.message_id,
    )


async def reply_ephemeral_from_callback(
    callback: CallbackQuery,
    cleanup: MessageCleanupService,
    text: str,
    **kwargs,
) -> Message:
    sent = await callback.message.answer(text, **kwargs)
    schedule_bot_message(cleanup, sent)
    return sent
