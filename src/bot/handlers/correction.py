from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message
from html import escape
import httpx
import logging

from src.bot.config import settings
from src.bot.handlers.food import _delete_status_message, send_result_card
from src.bot.keyboards.menus import correction_entries_keyboard
from src.bot.services.ai_client import AIAnalyzerClient
from src.bot.services.analysis_errors import ANALYSIS_UNAVAILABLE
from src.bot.services.entry_service import EntryService
from src.bot.services.formatting import format_activity_result, format_analysis_result
from src.bot.services.messaging import (
    answer_ephemeral,
    edit_ephemeral,
    schedule_bot_message,
    schedule_user_message,
)
from src.bot.services.message_cleanup import MessageCleanupService
from src.bot.services.request_limit import ensure_request_allowed
from src.bot.states import CorrectionStates
from src.db.models import EntryType
from src.db.repository import UserRepository

router = Router()
ai_client = AIAnalyzerClient()
logger = logging.getLogger(__name__)


def _format_current_items(items: list[dict] | None) -> str:
    if not items:
        return "Текущий состав не сохранен."

    lines = ["Текущий состав:"]
    for item in items:
        name = escape(str(item.get("name", "компонент")))
        quantity = escape(str(item.get("quantity") or "вес не указан"))
        lines.append(f"• {name}: {quantity}")
    return "\n".join(lines)


def _format_current_activity(entry) -> str:
    lines = [f"Текущая активность: {escape(entry.title)}"]
    lines.append(f"Сожжено: {entry.calories:.0f} ккал")
    if entry.duration_minutes:
        lines.append(f"Длительность: {entry.duration_minutes} мин")
    return "\n".join(lines)


async def _find_related_photo_file_id(repo: UserRepository, analysis_id: int | None) -> str | None:
    current_id = analysis_id
    visited = 0
    while current_id and visited < 10:
        analysis = await repo.get_analysis(current_id)
        if analysis is None:
            return None
        if analysis.image_path:
            return analysis.image_path
        current_id = analysis.previous_analysis_id
        visited += 1
    return None


@router.message(Command("correct"))
async def start_correction(message: Message, session, state: FSMContext, cleanup: MessageCleanupService) -> None:
    repo = UserRepository(session)
    user = await repo.get_or_create_user(message.from_user.id, settings.default_timezone)
    meals = await repo.get_recent_meal_entries(user.id, limit=5)
    if not meals:
        await answer_ephemeral(message, cleanup, "Нет приемов пищи для исправления.")
        return

    entries = [(meal.id, meal.title) for meal in meals]
    await answer_ephemeral(
        message,
        cleanup,
        "Выберите прием пищи для исправления:",
        reply_markup=correction_entries_keyboard(entries),
    )


@router.callback_query(F.data.startswith("correct:"))
async def choose_entry_for_correction(
    callback: CallbackQuery,
    state: FSMContext,
    cleanup: MessageCleanupService,
) -> None:
    entry_id = int(callback.data.split(":")[1])
    await state.set_state(CorrectionStates.waiting_text)
    await state.update_data(
        correct_entry_id=entry_id,
        prompt_chat_id=callback.message.chat.id,
        prompt_message_id=callback.message.message_id,
    )
    await edit_ephemeral(
        callback,
        cleanup,
        "Опишите, что нужно исправить.\n"
        "Например: «порция была 200 г, а не 100 г» или «добавь соус».",
    )
    await callback.answer()


@router.callback_query(F.data.startswith("meal_edit:"))
async def edit_meal_card(
    callback: CallbackQuery,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    entry_id = int(callback.data.split(":")[1])
    repo = UserRepository(session)
    user = await repo.get_or_create_user(callback.from_user.id, settings.default_timezone)
    entry = await repo.get_entry(entry_id, user.id)
    if entry is None or entry.entry_type not in {EntryType.MEAL, EntryType.ACTIVITY}:
        await callback.answer("Запись не найдена", show_alert=True)
        return

    await state.set_state(CorrectionStates.waiting_text)
    await state.update_data(
        correct_entry_id=entry_id,
        card_chat_id=callback.message.chat.id,
        card_message_id=callback.message.message_id,
    )
    if entry.entry_type == EntryType.ACTIVITY:
        prompt_text = (
            f"{_format_current_activity(entry)}\n\n"
            "Отправьте исправленное описание активности одним сообщением.\n"
            "Например: «пробежка 45 минут» или «ходьба 60 мин, легкий темп»."
        )
    else:
        prompt_text = (
            f"{_format_current_items(entry.items)}\n\n"
            "Отправьте исправленный состав и граммовки одним сообщением.\n"
            "Например: «рис 180 г, курица 120 г, соус 30 г»."
        )
    prompt_message = await callback.message.answer(prompt_text)
    schedule_bot_message(cleanup, prompt_message)
    await state.update_data(
        prompt_chat_id=prompt_message.chat.id,
        prompt_message_id=prompt_message.message_id,
    )
    await callback.answer()


@router.callback_query(F.data.startswith("meal_delete:"))
async def delete_meal_card(callback: CallbackQuery, state: FSMContext, session) -> None:
    entry_id = int(callback.data.split(":")[1])
    repo = UserRepository(session)
    user = await repo.get_or_create_user(callback.from_user.id, settings.default_timezone)
    entry = await repo.get_entry(entry_id, user.id)
    if entry is None or entry.entry_type not in {EntryType.MEAL, EntryType.ACTIVITY}:
        await callback.answer("Запись не найдена", show_alert=True)
        return

    await repo.delete_entry(entry)
    try:
        await callback.message.delete()
    except Exception:
        if entry.entry_type == EntryType.ACTIVITY:
            deleted_text = "Запись удалена. Сожженные калории убраны из статистики."
        else:
            deleted_text = "Запись удалена. Калории и БЖУ убраны из статистики."
        try:
            await callback.message.edit_caption(caption=deleted_text, reply_markup=None)
        except Exception:
            try:
                await callback.message.edit_text(deleted_text, reply_markup=None)
            except Exception:
                pass
    await state.clear()
    await callback.answer("Удалено")


@router.message(CorrectionStates.waiting_text)
async def apply_correction(
    message: Message,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    data = await state.get_data()
    entry_id = data.get("correct_entry_id")
    if not entry_id:
        await state.clear()
        await answer_ephemeral(message, cleanup, "Не выбрана запись для исправления.", track_user=False)
        schedule_user_message(cleanup, message)
        return

    repo = UserRepository(session)
    user = await repo.get_or_create_user(message.from_user.id, settings.default_timezone)
    entry = await repo.get_entry(entry_id, user.id)
    if entry is None or entry.entry_type not in {EntryType.MEAL, EntryType.ACTIVITY}:
        await state.clear()
        await answer_ephemeral(message, cleanup, "Запись не найдена.", track_user=False)
        schedule_user_message(cleanup, message)
        return

    if not await ensure_request_allowed(message, repo, user, cleanup, track_user=True):
        return

    previous = None
    photo_file_id = await _find_related_photo_file_id(repo, entry.ai_analysis_id)
    if entry.ai_analysis_id:
        analysis = await repo.get_analysis(entry.ai_analysis_id)
        if analysis and analysis.parsed_json:
            previous = analysis.parsed_json

    status_message = await answer_ephemeral(
        message,
        cleanup,
        "Пересчитываю с учетом исправления...",
        track_user=False,
    )
    analysis_mode = "activity" if entry.entry_type == EntryType.ACTIVITY else "meal"
    try:
        raw, result = await ai_client.analyze_text(
            mode=analysis_mode,
            text=message.text,
            previous_result=previous,
        )
    except httpx.HTTPError:
        logger.exception("Correction analysis request failed")
        await _delete_status_message(message, status_message)
        await answer_ephemeral(
            message,
            cleanup,
            ANALYSIS_UNAVAILABLE,
            track_user=False,
        )
        return

    service = EntryService(session)
    if entry.entry_type == EntryType.ACTIVITY:
        balance = await service.update_activity_from_correction(
            user=user,
            entry=entry,
            correction_text=message.text,
            raw_response=raw,
            result=result,
            image_path=None,
        )
        result_text = format_activity_result(result, balance)
    else:
        balance = await service.update_meal_from_correction(
            user=user,
            entry=entry,
            correction_text=message.text,
            raw_response=raw,
            result=result,
            image_path=None,
        )
        result_text = format_analysis_result(result, balance)

    await state.clear()
    messages_to_delete = [
        (data.get("card_chat_id"), data.get("card_message_id")),
        (data.get("prompt_chat_id"), data.get("prompt_message_id")),
        (message.chat.id, message.message_id),
        (status_message.chat.id, status_message.message_id),
    ]
    for chat_id, message_id in messages_to_delete:
        if not chat_id or not message_id:
            continue
        try:
            await message.bot.delete_message(chat_id=chat_id, message_id=message_id)
        except Exception:
            pass

    await send_result_card(
        message,
        cleanup,
        result_text=result_text,
        entry_id=entry.id,
        photo_file_id=photo_file_id,
        is_favorited=await repo.get_favorite_by_source_entry(user.id, entry.id) is not None,
        with_meal_actions=True,
    )
