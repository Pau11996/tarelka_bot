from __future__ import annotations

from aiogram.types import CallbackQuery, Message, ReplyKeyboardMarkup, ReplyKeyboardRemove

from src.bot.keyboards.menus import MAIN_MENU_ANCHOR, main_menu
from src.bot.services.message_cleanup import MessageCleanupService


def _reply_markup_has_main_menu(reply_markup) -> bool:
    return isinstance(reply_markup, ReplyKeyboardMarkup)


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
    # Reply keyboards must not ride on TTL-deleted messages — clients drop the menu.
    if _reply_markup_has_main_menu(kwargs.get("reply_markup")):
        cleanup.remember_menu_message(sent.chat.id, sent.message_id)
    else:
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
    sent = await message.answer(text, **kwargs)
    if cleanup is not None and _reply_markup_has_main_menu(kwargs.get("reply_markup")):
        cleanup.remember_menu_message(sent.chat.id, sent.message_id)
    return sent


async def answer_persistent_with_menu(
    message: Message,
    text: str,
    *,
    cleanup: MessageCleanupService | None = None,
    **kwargs,
) -> Message:
    removed = await drop_cached_reply_keyboard(message)
    try:
        kwargs["reply_markup"] = main_menu()
        return await answer_persistent(message, text, cleanup=cleanup, **kwargs)
    except Exception:
        # Never leave the chat without a reply keyboard after an explicit remove.
        try:
            await answer_persistent(
                message,
                MAIN_MENU_ANCHOR,
                cleanup=cleanup,
                reply_markup=main_menu(),
            )
        except Exception:
            pass
        raise
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
