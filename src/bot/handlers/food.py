import logging

import httpx
from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from src.bot.config import settings
from src.bot.keyboards.menus import MENU_BUTTON_TEXTS, meal_card_keyboard
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
from src.bot.services.referrals import reward_referrer_after_first_analysis
from src.bot.services.request_limit import ensure_request_allowed
from src.bot.states import CorrectionStates, SurveyStates
from src.db.models import AnalysisType
from src.db.repository import UserRepository
from src.shared.schemas import AnalysisResult

router = Router()
ai_client = AIAnalyzerClient()
logger = logging.getLogger(__name__)
MAX_PHOTO_CAPTION_LENGTH = 1024
MAX_VOICE_DURATION_SECONDS = 60

VOICE_TOO_LONG = (
    f"Голосовое слишком длинное. Отправьте сообщение до {MAX_VOICE_DURATION_SECONDS} секунд."
)
VOICE_NOT_RECOGNIZED = "Не удалось распознать речь. Попробуйте ещё раз или напишите текстом."
VOICE_UNAVAILABLE = (
    "Голосовой ввод временно недоступен.\n"
    "Отправьте описание текстом или фото."
)


async def _delete_status_message(message: Message, status: Message) -> None:
    try:
        await message.bot.delete_message(chat_id=status.chat.id, message_id=status.message_id)
    except Exception:
        pass


async def _require_profile(
    message: Message,
    session,
    cleanup: MessageCleanupService,
) -> tuple:
    del cleanup
    repo = UserRepository(session)
    user = await repo.get_or_create_user(message.from_user.id, settings.default_timezone)
    profile = await repo.ensure_default_profile(user.id)
    return user, profile


async def _delete_original_and_send_photo_result(
    message: Message,
    cleanup: MessageCleanupService,
    *,
    photo_file_id: str,
    result_text: str,
    entry_id: int | None = None,
    with_meal_actions: bool = False,
    is_profile_complete: bool = True,
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
        is_profile_complete=is_profile_complete,
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
    is_profile_complete: bool = True,
) -> None:
    persistent = entry_id is not None
    reply_markup = (
        meal_card_keyboard(
            entry_id,
            is_favorited=is_favorited,
            is_profile_complete=is_profile_complete,
        )
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


async def _save_and_send_text_result(
    message: Message,
    cleanup: MessageCleanupService,
    *,
    session,
    user,
    input_text: str,
    raw: str,
    result: AnalysisResult,
    is_profile_complete: bool = True,
) -> None:
    service = EntryService(session)
    schedule_user_message(cleanup, message, persistent=True)
    if result.type == "activity":
        entry, balance = await service.save_activity_from_analysis(
            user=user,
            analysis_type=AnalysisType.ACTIVITY_TEXT,
            input_text=input_text,
            image_path=None,
            raw_response=raw,
            result=result,
        )
        await reward_referrer_after_first_analysis(
            message.bot,
            service.repo,
            referred_user_id=user.id,
        )
        await send_result_card(
            message,
            cleanup,
            result_text=format_activity_result(result, balance),
            entry_id=entry.id,
            with_meal_actions=True,
            is_profile_complete=is_profile_complete,
        )
        return

    entry, balance = await service.save_meal_from_analysis(
        user=user,
        analysis_type=AnalysisType.FOOD_TEXT,
        input_text=input_text,
        image_path=None,
        raw_response=raw,
        result=result,
    )
    await reward_referrer_after_first_analysis(
        message.bot,
        service.repo,
        referred_user_id=user.id,
    )
    await send_result_card(
        message,
        cleanup,
        result_text=format_analysis_result(result, balance),
        entry_id=entry.id,
        with_meal_actions=True,
        is_profile_complete=is_profile_complete,
    )


@router.message(F.photo)
async def handle_food_photo(message: Message, state: FSMContext, session, cleanup: MessageCleanupService) -> None:
    current_state = await state.get_state()
    if current_state and "ProfileStates" in str(current_state):
        return
    if current_state and "SurveyStates" in str(current_state):
        return
    if current_state == CorrectionStates.waiting_text:
        return

    user, profile = await _require_profile(message, session, cleanup)

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
        await reward_referrer_after_first_analysis(
            message.bot,
            service.repo,
            referred_user_id=user.id,
        )
        await _delete_status_message(message, status)
        await _delete_original_and_send_photo_result(
            message,
            cleanup,
            photo_file_id=photo_file_id,
            result_text=format_activity_result(result, balance),
            entry_id=entry.id,
            with_meal_actions=True,
            is_profile_complete=profile.is_complete(),
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
    await reward_referrer_after_first_analysis(
        message.bot,
        service.repo,
        referred_user_id=user.id,
    )
    await _delete_status_message(message, status)
    await _delete_original_and_send_photo_result(
        message,
        cleanup,
        photo_file_id=photo_file_id,
        result_text=format_analysis_result(result, balance),
        entry_id=entry.id,
        with_meal_actions=True,
        is_profile_complete=profile.is_complete(),
    )


@router.message(F.voice)
async def handle_food_voice(message: Message, state: FSMContext, session, cleanup: MessageCleanupService) -> None:
    current_state = await state.get_state()
    if current_state and "ProfileStates" in str(current_state):
        return
    if current_state and "SurveyStates" in str(current_state):
        return
    if current_state == CorrectionStates.waiting_text:
        return

    voice = message.voice
    if voice is None:
        return
    if voice.duration and voice.duration > MAX_VOICE_DURATION_SECONDS:
        await answer_ephemeral(message, cleanup, VOICE_TOO_LONG, track_user=True)
        return

    user, profile = await _require_profile(message, session, cleanup)

    repo = UserRepository(session)
    if not await ensure_request_allowed(message, repo, user, cleanup, track_user=True):
        return

    status = await answer_ephemeral(
        message,
        cleanup,
        f"Слушаю голосовое...\n\n{ANALYSIS_DURATION_HINT}",
        track_user=False,
    )

    file = await message.bot.get_file(voice.file_id)
    file_bytes = await message.bot.download_file(file.file_path)
    content = file_bytes.read()

    try:
        transcript = await ai_client.transcribe(audio_bytes=content, filename="voice.ogg")
    except httpx.HTTPStatusError as exc:
        logger.exception("Voice transcription request failed")
        await _delete_status_message(message, status)
        if exc.response is not None and exc.response.status_code == 400:
            await answer_ephemeral(message, cleanup, VOICE_NOT_RECOGNIZED, track_user=False)
        else:
            await answer_ephemeral(message, cleanup, VOICE_UNAVAILABLE, track_user=False)
        return
    except httpx.HTTPError:
        logger.exception("Voice transcription request failed")
        await _delete_status_message(message, status)
        await answer_ephemeral(message, cleanup, VOICE_UNAVAILABLE, track_user=False)
        return

    if not transcript:
        await _delete_status_message(message, status)
        await answer_ephemeral(message, cleanup, VOICE_NOT_RECOGNIZED, track_user=False)
        return

    try:
        await message.bot.edit_message_text(
            chat_id=status.chat.id,
            message_id=status.message_id,
            text=(
                f"Распознал: {transcript}\n\n"
                f"Анализирую...\n\n{ANALYSIS_DURATION_HINT}"
            ),
        )
    except Exception:
        pass

    try:
        raw, result = await ai_client.analyze_text(
            mode="auto",
            text=transcript,
            profile_context=profile_context(profile),
        )
    except httpx.HTTPError:
        logger.exception("Voice analysis request failed")
        await _delete_status_message(message, status)
        await answer_ephemeral(
            message,
            cleanup,
            ANALYSIS_UNAVAILABLE,
            track_user=False,
        )
        return

    await _delete_status_message(message, status)
    await _save_and_send_text_result(
        message,
        cleanup,
        session=session,
        user=user,
        input_text=transcript,
        raw=raw,
        result=result,
        is_profile_complete=profile.is_complete(),
    )


@router.message(F.text & ~F.text.in_(MENU_BUTTON_TEXTS))
async def handle_food_text(message: Message, state: FSMContext, session, cleanup: MessageCleanupService) -> None:
    current_state = await state.get_state()
    if current_state and "ProfileStates" in str(current_state):
        return
    if current_state == CorrectionStates.waiting_text:
        return
    if current_state == SurveyStates.feedback:
        return
    if current_state and "SurveyStates" in str(current_state):
        return
    if message.text.startswith("/"):
        return

    user, profile = await _require_profile(message, session, cleanup)

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

    await _delete_status_message(message, status)
    await _save_and_send_text_result(
        message,
        cleanup,
        session=session,
        user=user,
        input_text=message.text,
        raw=raw,
        result=result,
        is_profile_complete=profile.is_complete(),
    )
