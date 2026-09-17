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
    format_unknown_result,
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
from src.bot.services.request_limit import RequestGrant, ensure_request_allowed, refund_request
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

STATUS_CLASSIFY = f"Определяю тип ввода...\n\n{ANALYSIS_DURATION_HINT}"
STATUS_PHOTO_DETAIL = f"Разбираю состав по фото...\n\n{ANALYSIS_DURATION_HINT}"
STATUS_CALCULATE = f"Считаю калории...\n\n{ANALYSIS_DURATION_HINT}"
STATUS_ACTIVITY = f"Анализирую активность...\n\n{ANALYSIS_DURATION_HINT}"
STATUS_ANALYZE_PHOTO = f"Определяю тип ввода...\n\n{ANALYSIS_DURATION_HINT}"
STATUS_ANALYZE_TEXT = f"Определяю тип ввода...\n\n{ANALYSIS_DURATION_HINT}"
STATUS_ANALYZE_VOICE = f"Слушаю голосовое...\n\n{ANALYSIS_DURATION_HINT}"


def progress_status_text(
    event: str,
    payload: dict,
    *,
    transcript: str | None = None,
) -> str | None:
    result_type = str(payload.get("type") or "")
    if event == "classified" and result_type == "activity":
        body = STATUS_ACTIVITY
    elif event == "photo_detail":
        body = STATUS_PHOTO_DETAIL
    elif event == "calculate" and result_type == "activity":
        body = STATUS_ACTIVITY
    elif event == "calculate":
        body = STATUS_CALCULATE
    else:
        return None
    if transcript:
        return f"Распознал: {transcript}\n\n{body}"
    return body


async def _delete_status_message(message: Message, status: Message) -> None:
    try:
        await message.bot.delete_message(chat_id=status.chat.id, message_id=status.message_id)
    except Exception:
        pass


async def _edit_status_message(message: Message, status: Message, text: str) -> None:
    try:
        await message.bot.edit_message_text(
            chat_id=status.chat.id,
            message_id=status.message_id,
            text=text,
        )
    except Exception:
        pass


def _progress_handler(message: Message, status: Message, *, transcript: str | None = None):
    async def on_progress(event: str, payload: dict) -> None:
        text = progress_status_text(event, payload, transcript=transcript)
        if text:
            await _edit_status_message(message, status, text)

    return on_progress


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


async def _send_unknown_result(
    message: Message,
    cleanup: MessageCleanupService,
    *,
    session,
    user,
    analysis_type: AnalysisType,
    input_text: str | None,
    image_path: str | None,
    raw: str,
    result: AnalysisResult,
    grant: RequestGrant | None,
) -> None:
    service = EntryService(session)
    await service.log_unknown_analysis(
        user=user,
        analysis_type=analysis_type,
        input_text=input_text,
        image_path=image_path,
        raw_response=raw,
        result=result,
    )
    if grant is not None:
        await refund_request(service.repo, user, grant)
    await answer_ephemeral(
        message,
        cleanup,
        format_unknown_result(result),
        track_user=False,
    )


async def _save_and_send_text_result(
    message: Message,
    cleanup: MessageCleanupService,
    *,
    session,
    user,
    input_text: str,
    raw: str,
    result: AnalysisResult,
    grant: RequestGrant | None = None,
    is_profile_complete: bool = True,
) -> None:
    if result.type == "unknown":
        await _send_unknown_result(
            message,
            cleanup,
            session=session,
            user=user,
            analysis_type=AnalysisType.FOOD_TEXT,
            input_text=input_text,
            image_path=None,
            raw=raw,
            result=result,
            grant=grant,
        )
        return

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
    grant = await ensure_request_allowed(message, repo, user, cleanup)
    if not grant:
        return

    status = await answer_ephemeral(
        message,
        cleanup,
        STATUS_ANALYZE_PHOTO,
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
            on_progress=_progress_handler(message, status),
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

    await _delete_status_message(message, status)

    if result.type == "unknown":
        await _send_unknown_result(
            message,
            cleanup,
            session=session,
            user=user,
            analysis_type=AnalysisType.FOOD_PHOTO,
            input_text=message.caption,
            image_path=None,
            raw=raw,
            result=result,
            grant=grant,
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
    grant = await ensure_request_allowed(message, repo, user, cleanup, track_user=True)
    if not grant:
        return

    status = await answer_ephemeral(
        message,
        cleanup,
        STATUS_ANALYZE_VOICE,
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

    await _edit_status_message(
        message,
        status,
        f"Распознал: {transcript}\n\n{STATUS_CLASSIFY}",
    )

    try:
        raw, result = await ai_client.analyze_text(
            mode="auto",
            text=transcript,
            profile_context=profile_context(profile),
            on_progress=_progress_handler(message, status, transcript=transcript),
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
        grant=grant,
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
    grant = await ensure_request_allowed(message, repo, user, cleanup, track_user=True)
    if not grant:
        return

    status = await answer_ephemeral(
        message,
        cleanup,
        STATUS_ANALYZE_TEXT,
        track_user=False,
    )

    try:
        raw, result = await ai_client.analyze_text(
            mode="auto",
            text=message.text,
            profile_context=profile_context(profile),
            on_progress=_progress_handler(message, status),
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
        grant=grant,
        is_profile_complete=profile.is_complete(),
    )
