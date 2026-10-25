"""Keep navigation and Telegram service events out of dialogue input handlers."""
from aiogram.types import Message

from src.bot.keyboards.menus import MENU_BUTTON_TEXTS


def form_input(message: Message) -> bool:
    text = message.text or ""
    return message.successful_payment is None and not text.startswith("/") and text not in MENU_BUTTON_TEXTS
