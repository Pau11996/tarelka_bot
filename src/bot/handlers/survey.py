from aiogram import F, Router
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from src.bot.config import settings
from src.bot.keyboards.menus import (
    MENU_BUTTON_TEXTS,
    survey_feedback_keyboard,
    survey_rating_keyboard,
)
from src.bot.services.message_cleanup import MessageCleanupService
from src.bot.services.messaging import answer_ephemeral, edit_ephemeral
from src.bot.services.survey_texts import (
    SURVEY_ALREADY_DONE,
    SURVEY_Q1_APP,
    SURVEY_Q2_PHOTO,
    SURVEY_Q3_FEEDBACK,
    SURVEY_THANKS,
)
from src.bot.states import SurveyStates
from src.db.repository import UserRepository

router = Router()

MAX_FEEDBACK_LENGTH = 2000


async def start_survey_flow(
    message: Message,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
    *,
    track_user: bool = True,
) -> None:
    repo = UserRepository(session)
    user = await repo.get_or_create_user(
        telegram_id=message.from_user.id,
        timezone=settings.default_timezone,
    )
    if await repo.has_survey_response(user.id):
        await answer_ephemeral(message, cleanup, SURVEY_ALREADY_DONE, track_user=track_user)
        return

    await state.set_state(SurveyStates.app_rating)
    await answer_ephemeral(
        message,
        cleanup,
        SURVEY_Q1_APP,
        reply_markup=survey_rating_keyboard("survey:app"),
        track_user=track_user,
    )


@router.message(Command("survey"))
async def cmd_survey(
    message: Message,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    await start_survey_flow(message, state, session, cleanup)


@router.callback_query(F.data == "survey:start")
async def survey_start_callback(
    callback: CallbackQuery,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    repo = UserRepository(session)
    user = await repo.get_or_create_user(
        telegram_id=callback.from_user.id,
        timezone=settings.default_timezone,
    )
    if await repo.has_survey_response(user.id):
        await edit_ephemeral(callback, cleanup, SURVEY_ALREADY_DONE)
        await callback.answer()
        return

    await state.set_state(SurveyStates.app_rating)
    await edit_ephemeral(
        callback,
        cleanup,
        SURVEY_Q1_APP,
        reply_markup=survey_rating_keyboard("survey:app"),
    )
    await callback.answer()


def _parse_rating(data: str, prefix: str) -> int | None:
    if not data.startswith(f"{prefix}:"):
        return None
    value = data.split(":", 2)[-1]
    if value == "skip":
        return None
    if value.isdigit():
        rating = int(value)
        if 1 <= rating <= 5:
            return rating
    return None


@router.callback_query(StateFilter(SurveyStates.app_rating), F.data.startswith("survey:app:"))
async def survey_app_rating(
    callback: CallbackQuery,
    state: FSMContext,
    cleanup: MessageCleanupService,
) -> None:
    rating = _parse_rating(callback.data or "", "survey:app")
    if rating is None:
        await callback.answer("Выберите оценку от 1 до 5", show_alert=True)
        return

    await state.update_data(app_rating=rating)
    await state.set_state(SurveyStates.photo_rating)
    await edit_ephemeral(
        callback,
        cleanup,
        SURVEY_Q2_PHOTO,
        reply_markup=survey_rating_keyboard("survey:photo", allow_skip=True),
    )
    await callback.answer()


@router.callback_query(StateFilter(SurveyStates.photo_rating), F.data.startswith("survey:photo:"))
async def survey_photo_rating(
    callback: CallbackQuery,
    state: FSMContext,
    cleanup: MessageCleanupService,
) -> None:
    data = callback.data or ""
    if data == "survey:photo:skip":
        photo_rating = None
    else:
        photo_rating = _parse_rating(data, "survey:photo")
        if photo_rating is None:
            await callback.answer("Выберите оценку от 1 до 5", show_alert=True)
            return

    await state.update_data(photo_rating=photo_rating)
    await state.set_state(SurveyStates.feedback)
    await edit_ephemeral(
        callback,
        cleanup,
        SURVEY_Q3_FEEDBACK,
        reply_markup=survey_feedback_keyboard(),
    )
    await callback.answer()


async def _finish_survey(
    *,
    message: Message,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
    telegram_id: int,
    feedback_text: str | None,
    track_user: bool = True,
) -> None:
    data = await state.get_data()
    app_rating = data.get("app_rating")
    if not isinstance(app_rating, int) or not (1 <= app_rating <= 5):
        await state.clear()
        await answer_ephemeral(
            message,
            cleanup,
            "Опрос прерван. Начните снова: /survey",
            track_user=track_user,
        )
        return

    photo_rating = data.get("photo_rating")
    if photo_rating is not None and (
        not isinstance(photo_rating, int) or not (1 <= photo_rating <= 5)
    ):
        photo_rating = None

    repo = UserRepository(session)
    user = await repo.get_or_create_user(
        telegram_id=telegram_id,
        timezone=settings.default_timezone,
    )
    if await repo.has_survey_response(user.id):
        await state.clear()
        await answer_ephemeral(message, cleanup, SURVEY_ALREADY_DONE, track_user=track_user)
        return

    cleaned = feedback_text.strip() if feedback_text else None
    if cleaned == "":
        cleaned = None
    if cleaned and len(cleaned) > MAX_FEEDBACK_LENGTH:
        cleaned = cleaned[:MAX_FEEDBACK_LENGTH]

    await repo.save_survey_response(
        user.id,
        app_rating=app_rating,
        photo_rating=photo_rating,
        feedback_text=cleaned,
    )
    await state.clear()
    await answer_ephemeral(message, cleanup, SURVEY_THANKS, track_user=track_user)


@router.callback_query(StateFilter(SurveyStates.feedback), F.data == "survey:feedback:skip")
async def survey_feedback_skip(
    callback: CallbackQuery,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    await edit_ephemeral(callback, cleanup, SURVEY_Q3_FEEDBACK)
    await _finish_survey(
        message=callback.message,
        state=state,
        session=session,
        cleanup=cleanup,
        telegram_id=callback.from_user.id,
        feedback_text=None,
        track_user=False,
    )
    await callback.answer()


@router.message(StateFilter(SurveyStates.feedback), F.text & ~F.text.in_(MENU_BUTTON_TEXTS))
async def survey_feedback_text(
    message: Message,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    if message.text and message.text.startswith("/"):
        await state.clear()
        return

    await _finish_survey(
        message=message,
        state=state,
        session=session,
        cleanup=cleanup,
        telegram_id=message.from_user.id,
        feedback_text=message.text,
    )
