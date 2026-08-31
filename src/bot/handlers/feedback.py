from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import Message

from src.bot.keyboards.menus import CONTACTS_BUTTON, LEGACY_CONTACTS_BUTTON, contacts_keyboard
from src.bot.services.links import format_contacts
from src.bot.services.messaging import answer_ephemeral
from src.bot.services.message_cleanup import MessageCleanupService

router = Router()


@router.message(Command("contacts"))
@router.message(Command("feedback"))
@router.message(F.text == CONTACTS_BUTTON)
@router.message(F.text == LEGACY_CONTACTS_BUTTON)
async def show_contacts(message: Message, cleanup: MessageCleanupService) -> None:
    await answer_ephemeral(
        message,
        cleanup,
        format_contacts(),
        reply_markup=contacts_keyboard(),
    )
