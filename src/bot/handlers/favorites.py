from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, Message

from src.bot.config import settings
from src.bot.handlers.food import send_result_card
from src.bot.keyboards.menus import favorites_keyboard, meal_card_keyboard
from src.bot.services.entry_service import EntryService
from src.bot.services.formatting import (
    format_analysis_result,
    format_favorites_list,
)
from src.bot.services.messaging import (
    answer_ephemeral,
    edit_ephemeral,
    reply_ephemeral_from_callback,
    schedule_message,
)
from src.bot.services.message_cleanup import MessageCleanupService
from src.db.models import EntryType
from src.db.repository import UserRepository
from src.shared.schemas import AnalysisResult, NutrientItem

router = Router()


async def _update_meal_card_keyboard(
    callback: CallbackQuery,
    *,
    entry_id: int,
    is_favorited: bool,
) -> None:
    markup = meal_card_keyboard(entry_id, is_favorited=is_favorited)
    try:
        await callback.message.edit_reply_markup(reply_markup=markup)
    except Exception:
        pass


@router.message(Command("favorites"))
@router.message(F.text == "⭐ Избранное")
async def show_favorites(message: Message, session, cleanup: MessageCleanupService) -> None:
    repo = UserRepository(session)
    user = await repo.get_or_create_user(message.from_user.id, settings.default_timezone)
    profile = await repo.get_profile(user.id)
    if profile is None:
        await answer_ephemeral(message, cleanup, "Сначала заполните профиль: /profile")
        return

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
    if entry is None or entry.entry_type != EntryType.MEAL:
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
    favorite = await repo.get_favorite(favorite_id, user.id)
    if favorite is None:
        await callback.answer("Блюдо не найдено", show_alert=True)
        return

    service = EntryService(session)
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
    )
    await callback.answer("Добавлено в сегодня")


@router.callback_query(F.data.startswith("favorite_delete:"))
async def delete_favorite(callback: CallbackQuery, session, cleanup: MessageCleanupService) -> None:
    favorite_id = int(callback.data.split(":")[1])
    repo = UserRepository(session)
    user = await repo.get_or_create_user(callback.from_user.id, settings.default_timezone)
    favorite = await repo.get_favorite(favorite_id, user.id)
    if favorite is None:
        await callback.answer("Блюдо не найдено", show_alert=True)
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
