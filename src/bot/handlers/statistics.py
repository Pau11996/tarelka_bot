from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import BufferedInputFile, CallbackQuery, Message

from src.bot.config import settings
from src.bot.keyboards.menus import statistics_keyboard
from src.bot.services.charts import DailyCaloriesPoint, render_calories_chart_png
from src.bot.services.formatting import format_daily_balance, format_entry_list
from src.bot.services.messaging import answer_ephemeral, schedule_bot_message, schedule_user_message
from src.bot.services.message_cleanup import MessageCleanupService
from src.bot.services.nutrition import calculate_daily_balance, local_today
from src.bot.states import StatisticsStates
from src.db.models import EntryType
from src.db.repository import UserRepository

router = Router()

DATE_FORMATS = ("%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y")


def _normalize_date_input(value: str) -> str:
    return value.strip().strip(" .")


def _parse_date(value: str) -> date | None:
    value = _normalize_date_input(value)
    for date_format in DATE_FORMATS:
        try:
            return datetime.strptime(value, date_format).date()
        except ValueError:
            continue
    return None


def _month_points(entries, start_date: date, end_date: date) -> list[DailyCaloriesPoint]:
    calories_by_date: dict[date, float] = defaultdict(float)
    for entry in entries:
        if entry.entry_type == EntryType.MEAL:
            calories_by_date[entry.entry_date] += entry.calories

    days_count = (end_date - start_date).days + 1
    return [
        DailyCaloriesPoint(day=start_date + timedelta(days=offset), calories=calories_by_date[start_date + timedelta(days=offset)])
        for offset in range(days_count)
    ]


def _format_month_caption(points: list[DailyCaloriesPoint], target: float) -> str:
    values = [point.calories for point in points]
    non_empty_values = [value for value in values if value > 0]
    total = sum(values)
    average = total / len(non_empty_values) if non_empty_values else 0
    max_point = max(points, key=lambda point: point.calories) if points else None
    caption = (
        "📊 Калории за последние 30 дней\n"
        f"Всего съедено: {total:.0f} ккал\n"
        f"Среднее в непустой день: {average:.0f} ккал\n"
        f"Дневная норма: {target:.0f} ккал"
    )
    if max_point and max_point.calories > 0:
        caption += f"\nМаксимум: {max_point.calories:.0f} ккал ({max_point.day.strftime('%d.%m.%Y')})"
    return caption


@router.message(Command("stats"))
@router.message(F.text == "📈 Статистика")
async def show_statistics_menu(
    message: Message,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    await state.clear()
    repo = UserRepository(session)
    user = await repo.get_or_create_user(message.from_user.id, settings.default_timezone)
    profile = await repo.get_profile(user.id)
    if profile is None:
        await answer_ephemeral(message, cleanup, "Сначала заполните профиль: /profile")
        return

    await answer_ephemeral(
        message,
        cleanup,
        "📈 Статистика\n\nВыберите, что показать:",
        reply_markup=statistics_keyboard(),
    )


@router.callback_query(F.data == "stats:month")
async def show_month_statistics(
    callback: CallbackQuery,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    await state.clear()
    repo = UserRepository(session)
    user = await repo.get_or_create_user(callback.from_user.id, settings.default_timezone)
    profile = await repo.get_profile(user.id)
    if profile is None:
        await callback.answer("Сначала заполните профиль: /profile", show_alert=True)
        return

    end_date = local_today(user.timezone)
    start_date = end_date - timedelta(days=29)
    entries = await repo.get_entries_for_period(user.id, start_date, end_date)
    points = _month_points(entries, start_date, end_date)
    chart = render_calories_chart_png(points, target=profile.daily_calorie_target)
    sent = await callback.message.answer_photo(
        BufferedInputFile(chart, filename="calories_last_30_days.png"),
        caption=_format_month_caption(points, profile.daily_calorie_target),
    )
    schedule_bot_message(cleanup, sent)
    await callback.answer()


@router.callback_query(F.data == "stats:day")
async def ask_statistics_date(callback: CallbackQuery, state: FSMContext, cleanup: MessageCleanupService) -> None:
    await state.set_state(StatisticsStates.waiting_date)
    sent = await callback.message.answer(
        "Введите дату в формате ДД.ММ.ГГГГ.\nНапример: 18.06.2026"
    )
    schedule_bot_message(cleanup, sent)
    await callback.answer()


@router.message(StatisticsStates.waiting_date)
async def show_day_statistics(message: Message, state: FSMContext, session, cleanup: MessageCleanupService) -> None:
    selected_date = _parse_date(message.text or "")
    if selected_date is None:
        await state.clear()
        schedule_user_message(cleanup, message)
        await answer_ephemeral(
            message,
            cleanup,
            "Не понял дату. Можете продолжить пользоваться ботом или снова открыть «Статистика», чтобы выбрать день.",
            track_user=False,
        )
        return

    repo = UserRepository(session)
    user = await repo.get_or_create_user(message.from_user.id, settings.default_timezone)
    profile = await repo.get_profile(user.id)
    if profile is None:
        await state.clear()
        await answer_ephemeral(message, cleanup, "Сначала заполните профиль: /profile")
        return

    entries = await repo.get_entries_for_date(user.id, selected_date)
    balance = calculate_daily_balance(profile.daily_calorie_target, entries)
    text = f"📅 Статистика за {selected_date.strftime('%d.%m.%Y')}\n\n"
    text += format_daily_balance(balance)
    text += "\n\n" + format_entry_list(entries)

    await state.clear()
    schedule_user_message(cleanup, message)
    await answer_ephemeral(message, cleanup, text, track_user=False)
