from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from src.bot.config import settings
from src.bot.keyboards.menus import TODAY_BUTTON
from src.bot.services.formatting import format_daily_balance, format_entry_list
from src.bot.services.messaging import answer_ephemeral
from src.bot.services.message_cleanup import MessageCleanupService
from src.bot.services.nutrition import (
    calculate_daily_balance,
    calculate_logging_streak,
    local_today,
)
from src.db.repository import UserRepository

router = Router()


@router.message(Command("today"))
@router.message(F.text == TODAY_BUTTON)
async def show_today(message: Message, state: FSMContext, session, cleanup: MessageCleanupService) -> None:
    await state.clear()
    repo = UserRepository(session)
    user = await repo.get_or_create_user(message.from_user.id, settings.default_timezone)
    profile = await repo.ensure_default_profile(user.id)

    today = local_today(user.timezone)
    entries = await repo.get_entries_for_date(user.id, today)
    balance = calculate_daily_balance(profile.daily_calorie_target, entries)
    dates = await repo.get_distinct_entry_dates(user.id)
    streak = calculate_logging_streak(dates, today)

    text = format_daily_balance(balance, profile=profile, streak=streak)
    text += "\n\n" + format_entry_list(entries)
    await answer_ephemeral(message, cleanup, text)
