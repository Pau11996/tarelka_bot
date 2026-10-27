import asyncio
import secrets
from weakref import WeakValueDictionary

from aiogram import F, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from src.bot.config import settings
from src.bot.handlers.food import send_result_card
from src.bot.keyboards.menus import (
    FAVORITES_BUTTON,
    FAVORITES_ORDER_PAGE_SIZE,
    favorites_keyboard,
    favorites_order_keyboard,
    meal_card_keyboard,
)
from src.bot.services.entry_service import EntryService
from src.bot.services.formatting import (
    format_activity_result,
    format_analysis_result,
    format_favorites_list,
    format_water_result,
)
from src.bot.services.messaging import (
    answer_ephemeral,
    edit_ephemeral,
    reply_ephemeral_from_callback,
    schedule_message,
)
from src.bot.services.message_cleanup import MessageCleanupService
from src.db.models import DIARY_ENTRY_TYPES, EntryType
from src.db.repository import FavoriteOrderConflict, UserRepository
from src.shared.schemas import AnalysisResult, NutrientItem

router = Router()

# Serialize taps while Telegram edits the message. Weak values avoid retaining
# a lock for every user who has ever opened this screen.
_order_locks: WeakValueDictionary[tuple, asyncio.Lock] = WeakValueDictionary()


async def _edit_order_message(callback, cleanup, text, markup):
    try:
        await edit_ephemeral(callback, cleanup, text, reply_markup=markup)
    except TelegramBadRequest as exc:
        if "message is not modified" not in str(exc).lower():
            raise


async def _close_order(callback, state, cleanup, favorites):
    await _edit_order_message(
        callback, cleanup, format_favorites_list(favorites),
        favorites_keyboard(favorites) if favorites else None,
    )
    await state.update_data(favorite_order=None)


@router.callback_query(F.data.startswith("favorites_order:"))
async def change_favorites_order(callback: CallbackQuery, state: FSMContext, session, cleanup: MessageCleanupService):
    if not isinstance(callback.message, Message):
        await callback.answer("Откройте избранное заново: /favorites", show_alert=True)
        return
    key = (callback.bot.id, callback.message.chat.id, callback.from_user.id)
    lock = _order_locks.setdefault(key, asyncio.Lock())
    async with lock:
        await _change_favorites_order(callback, state, session, cleanup)


async def _change_favorites_order(callback, state, session, cleanup):
    repo = UserRepository(session)
    user = await repo.get_or_create_user(callback.from_user.id, settings.default_timezone)
    favorites = await repo.get_favorites(user.id)
    current_ids = [item.id for item in favorites]
    parts = callback.data.split(":")
    if parts == ["favorites_order", "start"]:
        if len(favorites) < 2:
            await callback.answer("Для перестановки нужны хотя бы две записи")
            return
        await state.clear()
        draft = {"nonce": secrets.token_hex(3), "version": 0, "page": 0,
                 "message_id": callback.message.message_id,
                 "original_ids": current_ids, "ids": current_ids[:]}
    else:
        stored = (await state.get_data()).get("favorite_order")
        if (not stored or len(parts) not in (4, 5) or parts[1] != stored["nonce"]
                or callback.message.message_id != stored["message_id"]):
            await callback.answer("Режим перестановки закрыт. Откройте /favorites заново.", show_alert=True)
            return
        if parts[2] != str(stored["version"]):
            await callback.answer("Список обновился. Нажмите ещё раз.")
            return
        draft = {**stored, "ids": stored["ids"][:]}
        action = parts[3]
        if action == "hint":
            await callback.answer("Нажмите ↑ или ↓ рядом с записью")
            return
        if action == "cancel":
            await _close_order(callback, state, cleanup, favorites)
            await callback.answer("Порядок не изменён")
            return
        if action == "save":
            try:
                favorites = await repo.reorder_favorites(user.id, draft["ids"], draft["original_ids"])
            except FavoriteOrderConflict:
                await _close_order(callback, state, cleanup, await repo.get_favorites(user.id))
                await callback.answer("Избранное изменилось. Начните перестановку заново.", show_alert=True)
                return
            await _close_order(callback, state, cleanup, favorites)
            await callback.answer("Порядок сохранён в боте и приложении")
            return
        if current_ids != draft["original_ids"]:
            await _close_order(callback, state, cleanup, favorites)
            await callback.answer("Избранное изменилось. Начните перестановку заново.", show_alert=True)
            return
        if len(parts) != 5 or not parts[4].isdigit():
            await callback.answer("Откройте избранное заново: /favorites")
            return
        target = int(parts[4])
        if action in ("up", "down") and target in draft["ids"]:
            index = draft["ids"].index(target)
            destination = index + (-1 if action == "up" else 1)
            if not 0 <= destination < len(favorites):
                await callback.answer()
                return
            draft["ids"][index], draft["ids"][destination] = draft["ids"][destination], draft["ids"][index]
            draft["page"] = destination // FAVORITES_ORDER_PAGE_SIZE
        elif action == "page" and 0 <= target < (len(favorites) + FAVORITES_ORDER_PAGE_SIZE - 1) // FAVORITES_ORDER_PAGE_SIZE:
            draft["page"] = target
        else:
            await callback.answer("Запись не найдена")
            return
        draft["version"] += 1
    by_id = {item.id: item for item in favorites}
    ordered = [by_id[item_id] for item_id in draft["ids"]]
    await _edit_order_message(
        callback, cleanup,
        "↕️ <b>Порядок в избранном</b>\n\n"
        "Поставьте частые записи наверх.\nНажимайте ↑ или ↓ рядом с записью.\n\n"
        "Когда закончите, нажмите «Готово».",
        favorites_order_keyboard(ordered, nonce=draft["nonce"], version=draft["version"], page=draft["page"]),
    )
    await state.update_data(favorite_order=draft)
    await callback.answer()


async def _update_meal_card_keyboard(
    callback: CallbackQuery,
    *,
    entry_id: int,
    is_favorited: bool,
    is_profile_complete: bool | None = None,
) -> None:
    if is_profile_complete is None:
        if callback.message and callback.message.reply_markup:
            is_profile_complete = not any(
                btn.callback_data == "start:begin"
                for row in callback.message.reply_markup.inline_keyboard
                for btn in row
            )
        else:
            is_profile_complete = True
    markup = meal_card_keyboard(
        entry_id,
        is_favorited=is_favorited,
        is_profile_complete=is_profile_complete,
    )
    try:
        await callback.message.edit_reply_markup(reply_markup=markup)
    except Exception:
        pass


@router.message(Command("favorites"))
@router.message(F.text == FAVORITES_BUTTON)
async def show_favorites(
    message: Message,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    await state.clear()
    repo = UserRepository(session)
    user = await repo.get_or_create_user(message.from_user.id, settings.default_timezone)
    await repo.ensure_default_profile(user.id)

    favorites = await repo.get_favorites(user.id)
    text = format_favorites_list(favorites)
    reply_markup = favorites_keyboard(favorites) if favorites else None
    await answer_ephemeral(message, cleanup, text, reply_markup=reply_markup)


@router.callback_query(F.data.startswith("meal_favorite:"))
async def add_meal_to_favorites(callback: CallbackQuery, session) -> None:
    entry_id = int(callback.data.split(":")[1])
    repo = UserRepository(session)
    user = await repo.get_or_create_user(callback.from_user.id, settings.default_timezone)
    entry = await repo.get_entry(entry_id, user.id)
    if entry is None or entry.entry_type not in DIARY_ENTRY_TYPES:
        await callback.answer("Запись не найдена", show_alert=True)
        return

    existing = await repo.get_favorite_by_source_entry(user.id, entry_id)
    if existing is not None:
        await callback.answer("Уже в избранном")
        await _update_meal_card_keyboard(callback, entry_id=entry_id, is_favorited=True)
        return

    await repo.create_favorite_from_entry(entry)
    await _update_meal_card_keyboard(callback, entry_id=entry_id, is_favorited=True)
    await callback.answer("Добавлено в избранное")


@router.callback_query(F.data.startswith("meal_favorited:"))
async def meal_already_favorited(callback: CallbackQuery) -> None:
    await callback.answer("Уже в избранном")


@router.callback_query(F.data.startswith("favorite_add:"))
async def add_favorite_to_today(callback: CallbackQuery, session, cleanup: MessageCleanupService) -> None:
    favorite_id = int(callback.data.split(":")[1])
    repo = UserRepository(session)
    user = await repo.get_or_create_user(callback.from_user.id, settings.default_timezone)
    profile = await repo.ensure_default_profile(user.id)
    is_profile_complete = profile.is_complete()
    favorite = await repo.get_favorite(favorite_id, user.id)
    if favorite is None:
        await callback.answer("Запись не найдена", show_alert=True)
        return

    service = EntryService(session)
    if favorite.entry_type == EntryType.ACTIVITY:
        entry, balance = await service.save_activity_from_favorite(user=user, favorite=favorite)
        result = AnalysisResult(
            type="activity",
            title=favorite.title,
            total_calories=favorite.calories,
            duration_minutes=favorite.duration_minutes,
        )
        await send_result_card(
            callback.message,
            cleanup,
            result_text=format_activity_result(result, balance),
            entry_id=entry.id,
            with_meal_actions=True,
            is_profile_complete=is_profile_complete,
        )
        await callback.answer("Добавлено в сегодня")
        return

    if favorite.entry_type == EntryType.WATER:
        entry, balance = await service.save_water_from_favorite(user=user, favorite=favorite)
        result = AnalysisResult(
            type="water",
            title=favorite.title,
            volume_ml=favorite.volume_ml,
        )
        await send_result_card(
            callback.message,
            cleanup,
            result_text=format_water_result(result, balance),
            entry_id=entry.id,
            with_meal_actions=True,
            is_profile_complete=is_profile_complete,
        )
        await callback.answer("Добавлено в сегодня")
        return

    entry, balance = await service.save_meal_from_favorite(user=user, favorite=favorite)

    items = [NutrientItem(**item) for item in (favorite.items or [])]
    result = AnalysisResult(
        type="meal",
        title=favorite.title,
        items=items,
        total_calories=favorite.calories,
        protein_g=favorite.protein_g,
        fat_g=favorite.fat_g,
        carbs_g=favorite.carbs_g,
        micronutrients=favorite.micronutrients or {},
    )
    await send_result_card(
        callback.message,
        cleanup,
        result_text=format_analysis_result(result, balance),
        entry_id=entry.id,
        with_meal_actions=True,
        is_profile_complete=is_profile_complete,
    )
    await callback.answer("Добавлено в сегодня")


@router.callback_query(F.data.startswith("favorite_delete:"))
async def delete_favorite(callback: CallbackQuery, session, cleanup: MessageCleanupService) -> None:
    favorite_id = int(callback.data.split(":")[1])
    repo = UserRepository(session)
    user = await repo.get_or_create_user(callback.from_user.id, settings.default_timezone)
    favorite = await repo.get_favorite(favorite_id, user.id)
    if favorite is None:
        await callback.answer("Запись не найдена", show_alert=True)
        return

    source_entry_id = favorite.source_entry_id
    await repo.delete_favorite(favorite)

    favorites = await repo.get_favorites(user.id)
    text = format_favorites_list(favorites)
    reply_markup = favorites_keyboard(favorites) if favorites else None
    try:
        await callback.message.edit_text(text, reply_markup=reply_markup)
        schedule_message(
            cleanup,
            callback.bot,
            callback.message.chat.id,
            callback.message.message_id,
        )
    except Exception:
        await reply_ephemeral_from_callback(
            callback,
            cleanup,
            text,
            reply_markup=reply_markup,
        )

    if source_entry_id is not None:
        entry = await repo.get_entry(source_entry_id, user.id)
        if entry is not None:
            is_favorited = await repo.get_favorite_by_source_entry(user.id, source_entry_id) is not None
            await _update_meal_card_keyboard(
                callback,
                entry_id=source_entry_id,
                is_favorited=is_favorited,
            )

    await callback.answer("Удалено из избранного")
