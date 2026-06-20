from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import Message

from src.bot.config import settings
from src.bot.keyboards.menus import main_menu
from src.bot.services.formatting import format_daily_balance, format_entry_list
from src.bot.services.messaging import answer_ephemeral
from src.bot.services.message_cleanup import MessageCleanupService
from src.bot.services.nutrition import calculate_daily_balance, local_today
from src.db.repository import UserRepository

router = Router()


@router.message(Command("today"))
@router.message(F.text == "📊 Сегодня")
async def show_today(message: Message, session, cleanup: MessageCleanupService) -> None:
    repo = UserRepository(session)
    user = await repo.get_or_create_user(message.from_user.id, settings.default_timezone)
    profile = await repo.get_profile(user.id)
    if profile is None:
        await answer_ephemeral(message, cleanup, "Сначала заполните профиль: /profile")
        return

    today = local_today(user.timezone)
    entries = await repo.get_entries_for_date(user.id, today)
    balance = calculate_daily_balance(profile.daily_calorie_target, entries)

    text = format_daily_balance(balance, profile=profile)
    text += "\n\n" + format_entry_list(entries)
    await answer_ephemeral(message, cleanup, text)
