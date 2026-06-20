from aiogram import Router
from aiogram.filters import Command
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message

from src.bot.services.links import feedback_chat_url
from src.bot.services.messaging import answer_ephemeral
from src.bot.services.message_cleanup import MessageCleanupService

router = Router()


@router.message(Command("feedback"))
async def show_feedback(message: Message, cleanup: MessageCleanupService) -> None:
    url = feedback_chat_url()
    if url is None:
        await answer_ephemeral(message, cleanup, "Чат для обратной связи пока не настроен.")
        return

    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="💬 Написать в чат", url=url)]]
    )
    await answer_ephemeral(
        message,
        cleanup,
        "Вопросы, идеи и предложения — в наш чат поддержки:",
        reply_markup=keyboard,
    )
