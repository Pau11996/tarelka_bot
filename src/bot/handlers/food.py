import logging

import httpx
from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from src.bot.config import settings
from src.bot.keyboards.menus import meal_card_keyboard
from src.bot.services.ai_client import AIAnalyzerClient
from src.bot.services.analysis_errors import ANALYSIS_DURATION_HINT, ANALYSIS_UNAVAILABLE
from src.bot.services.entry_service import EntryService
from src.bot.services.formatting import (
    format_activity_result,
    format_analysis_result,
    profile_context,
)
from src.bot.services.messaging import (
    answer_ephemeral,
    answer_persistent,
    answer_photo_ephemeral,
    answer_photo_persistent,
    schedule_user_message,
)
from src.bot.services.message_cleanup import MessageCleanupService
from src.bot.services.request_limit import ensure_request_allowed
from src.bot.states import CorrectionStates
from src.db.models import AnalysisType
from src.db.repository import UserRepository

router = Router()
ai_client = AIAnalyzerClient()
logger = logging.getLogger(__name__)
MAX_PHOTO_CAPTION_LENGTH = 1024


async def _delete_status_message(message: Message, status: Message) -> None:
    try:
        await message.bot.delete_message(chat_id=status.chat.id, message_id=status.message_id)
    except Exception:
        pass


async def _require_profile(
    message: Message,
    session,
    cleanup: MessageCleanupService,
) -> tuple | None:
    repo = UserRepository(session)
    user = await repo.get_or_create_user(message.from_user.id, settings.default_timezone)
    profile = await repo.get_profile(user.id)
    if profile is None:
        await answer_ephemeral(message, cleanup, "Сначала заполните профиль: /profile")
        return None
    return user, profile


async def _delete_original_and_send_photo_result(
    message: Message,
    cleanup: MessageCleanupService,
    *,
    photo_file_id: str,
    result_text: str,
    entry_id: int | None = None,
    with_meal_actions: bool = False,
) -> None:
    try:
        await message.delete()
    except Exception:
        pass

    await send_result_card(
        message,
        cleanup,
        result_text=result_text,
        entry_id=entry_id,
        photo_file_id=photo_file_id,
        with_meal_actions=with_meal_actions,
    )


async def send_result_card(
    message: Message,
    cleanup: MessageCleanupService,
    *,
    result_text: str,
    entry_id: int | None = None,
    photo_file_id: str | None = None,
    is_favorited: bool = False,
    with_meal_actions: bool = False,
) -> None:
    persistent = entry_id is not None
    reply_markup = (
        meal_card_keyboard(entry_id, is_favorited=is_favorited)
        if with_meal_actions and entry_id is not None
        else None
    )
    if not photo_file_id:
        if persistent:
            await answer_persistent(message, result_text, reply_markup=reply_markup)
        else:
            await answer_ephemeral(message, cleanup, result_text, track_user=False)
        return

    if len(result_text) <= MAX_PHOTO_CAPTION_LENGTH:
        if persistent:
            await answer_photo_persistent(
                message,
                photo=photo_file_id,
                caption=result_text,
                reply_markup=reply_markup,
            )
        else:
            await answer_photo_ephemeral(
                message,
                cleanup,
                track_user=False,
                photo=photo_file_id,
                caption=result_text,
            )
        return

    title = result_text.splitlines()[0] if result_text else "Результат анализа"
    if persistent:
        await answer_photo_persistent(message, photo=photo_file_id, caption=title, reply_markup=reply_markup)
        await answer_persistent(message, result_text, reply_markup=reply_markup)
    else:
        await answer_photo_ephemeral(
            message,
            cleanup,
            track_user=False,
            photo=photo_file_id,
            caption=title,
        )
        await answer_ephemeral(message, cleanup, result_text, track_user=False)


@router.message(F.photo)
async def handle_food_photo(message: Message, state: FSMContext, session, cleanup: MessageCleanupService) -> None:
    current_state = await state.get_state()
    if current_state and "ProfileStates" in str(current_state):
        return
    if current_state == CorrectionStates.waiting_text:
        return

    ctx = await _require_profile(message, session, cleanup)
    if ctx is None:
        return
    user, profile = ctx

    repo = UserRepository(session)
    if not await ensure_request_allowed(message, repo, user, cleanup):
        return

    status = await answer_ephemeral(
        message,
        cleanup,
        f"Анализирую фото...\n\n{ANALYSIS_DURATION_HINT}",
        track_user=False,
    )

    photo = message.photo[-1]
    photo_file_id = photo.file_id
    file = await message.bot.get_file(photo.file_id)
    file_bytes = await message.bot.download_file(file.file_path)
    content = file_bytes.read()

    try:
        raw, result = await ai_client.analyze_image(
            mode="auto",
            image_bytes=content,
            filename="upload.jpg",
            text=message.caption,
            profile_context=profile_context(profile),
        )
    except httpx.HTTPError:
        logger.exception("Photo analysis request failed")
        await _delete_status_message(message, status)
        await answer_ephemeral(
            message,
            cleanup,
            ANALYSIS_UNAVAILABLE,
            track_user=False,
        )
        return

    service = EntryService(session)
    if result.type == "activity":
        entry, balance = await service.save_activity_from_analysis(
            user=user,
            analysis_type=AnalysisType.ACTIVITY_PHOTO,
            input_text=message.caption,
            image_path=None,
            raw_response=raw,
            result=result,
        )
        await _delete_status_message(message, status)
        await _delete_original_and_send_photo_result(
            message,
            cleanup,
            photo_file_id=photo_file_id,
            result_text=format_activity_result(result, balance),
            entry_id=entry.id,
            with_meal_actions=True,
        )
        return

    entry, balance = await service.save_meal_from_analysis(
        user=user,
        analysis_type=AnalysisType.FOOD_PHOTO,
        input_text=message.caption,
        image_path=photo_file_id,
        raw_response=raw,
        result=result,
    )
    await _delete_status_message(message, status)
    await _delete_original_and_send_photo_result(
        message,
        cleanup,
        photo_file_id=photo_file_id,
        result_text=format_analysis_result(result, balance),
        entry_id=entry.id,
        with_meal_actions=True,
    )


@router.message(F.text & ~F.text.in_({"📊 Сегодня", "📈 Статистика", "👤 Профиль", "⭐ Избранное"}))
async def handle_food_text(message: Message, state: FSMContext, session, cleanup: MessageCleanupService) -> None:
    current_state = await state.get_state()
    if current_state and "ProfileStates" in str(current_state):
        return
    if current_state == CorrectionStates.waiting_text:
        return
    if message.text.startswith("/"):
        return

    ctx = await _require_profile(message, session, cleanup)
    if ctx is None:
        return
    user, profile = ctx

    repo = UserRepository(session)
    if not await ensure_request_allowed(message, repo, user, cleanup, track_user=True):
        return

    status = await answer_ephemeral(
        message,
        cleanup,
        f"Анализирую описание...\n\n{ANALYSIS_DURATION_HINT}",
        track_user=False,
    )

    try:
        raw, result = await ai_client.analyze_text(
            mode="auto",
            text=message.text,
            profile_context=profile_context(profile),
        )
    except httpx.HTTPError:
        logger.exception("Text analysis request failed")
        await _delete_status_message(message, status)
        await answer_ephemeral(
            message,
            cleanup,
            ANALYSIS_UNAVAILABLE,
            track_user=False,
        )
        return

    service = EntryService(session)
    await _delete_status_message(message, status)
    if result.type == "activity":
        schedule_user_message(cleanup, message, persistent=True)
        entry, balance = await service.save_activity_from_analysis(
            user=user,
            analysis_type=AnalysisType.ACTIVITY_TEXT,
            input_text=message.text,
            image_path=None,
            raw_response=raw,
            result=result,
        )
        await send_result_card(
            message,
            cleanup,
            result_text=format_activity_result(result, balance),
            entry_id=entry.id,
            with_meal_actions=True,
        )
        return

    schedule_user_message(cleanup, message, persistent=True)
    entry, balance = await service.save_meal_from_analysis(
        user=user,
        analysis_type=AnalysisType.FOOD_TEXT,
        input_text=message.text,
        image_path=None,
        raw_response=raw,
        result=result,
    )
    await send_result_card(
        message,
        cleanup,
        result_text=format_analysis_result(result, balance),
        entry_id=entry.id,
        with_meal_actions=True,
    )
