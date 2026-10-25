from __future__ import annotations

import logging
from datetime import datetime, timezone

from aiogram import F, Router
from aiogram.exceptions import TelegramAPIError, TelegramBadRequest
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from src.bot.config import settings
from src.bot.handlers.subscription import (
    format_subscription_status,
    show_subscription_screen,
)
from src.bot.keyboards.menus import (
    coach_refresh_keyboard,
    subscription_keyboard,
    week_menu_keyboard,
)
from src.bot.services.coach import (
    COACH_FAILED_TEXT,
    MIN_LOGGED_DAYS,
    NOT_ENOUGH_TEXT,
    REFRESH_SPENT_TEXT,
    calendar_week_start,
    decide_week_action,
    digest_facts,
    format_activity_report,
    load_week_digest,
    rolling_week,
    week_review_allowed,
    write_review_text,
)
from src.bot.services.diary_nudges import local_now_for_timezone
from src.bot.services.messaging import answer_ephemeral, answer_persistent
from src.bot.services.message_cleanup import MessageCleanupService
from src.db.models import CoachReview
from src.shared.review_service import get_week_review
from src.db.repository import UserRepository

logger = logging.getLogger(__name__)

router = Router()

WEEK_MENU_TEXT = (
    "🥗 ИИ-помощник по питанию\n\n"
    "Входит в вашу подписку и пока работает в бета-версии.\n"
    "Поможет разобрать пищевые привычки и записанную активность за неделю.\n\n"
    "Выберите, что хотите посмотреть:"
)

# The polling bot has one process, but dispatches updates concurrently.
_reviews_in_progress: set[int] = set()


def _keyboard_for(refresh_used: bool):
    if refresh_used:
        return None
    return coach_refresh_keyboard()


async def _current_review(repo: UserRepository, user) -> CoachReview | None:
    local_now = local_now_for_timezone(user.timezone, datetime.now(timezone.utc))
    return await repo.get_coach_review(user.id, calendar_week_start(local_now.date()))


async def _open_week(
    message: Message,
    session,
    cleanup: MessageCleanupService,
    *,
    telegram_id: int,
    refresh: bool,
) -> str:
    if telegram_id in _reviews_in_progress:
        await answer_persistent(
            message, "⏳ Разбор уже готовится. Дождитесь результата."
        )
        return "busy"
    _reviews_in_progress.add(telegram_id)
    try:
        return await _open_week_once(
            message, session, cleanup, telegram_id=telegram_id, refresh=refresh
        )
    finally:
        _reviews_in_progress.discard(telegram_id)


async def _open_week_once(
    message: Message,
    session,
    cleanup: MessageCleanupService,
    *,
    telegram_id: int,
    refresh: bool,
) -> str:
    repo = UserRepository(session)
    user = await repo.get_or_create_user(telegram_id, settings.default_timezone)
    subscribed = week_review_allowed(user)
    review = await _current_review(repo, user) if subscribed else None
    refresh_used = bool(review and review.refresh_used)
    action = decide_week_action(
        subscribed=subscribed,
        logged_days=MIN_LOGGED_DAYS,
        has_cache=review is not None,
        refresh=refresh,
        refresh_used=refresh_used,
    )
    if action == "paywall":
        await show_subscription_screen(message, user, cleanup)
        return action
    if action == "cache" and review is not None:
        await answer_persistent(
            message,
            review.review_text,
            reply_markup=_keyboard_for(review.refresh_used),
        )
        return action
    if action == "refresh_spent":
        return action

    _, digest = await load_week_digest(repo, user, now=datetime.now(timezone.utc))
    action = decide_week_action(
        subscribed=subscribed,
        logged_days=digest.logged_days,
        has_cache=review is not None,
        refresh=refresh,
        refresh_used=refresh_used,
    )
    if action == "need_data":
        await answer_persistent(message, NOT_ENOUGH_TEXT)
        return action
    if action not in {"generate", "refresh"}:
        return action

    status = await answer_ephemeral(
        message,
        cleanup,
        "⏳ Анализирую ваши записи за неделю…\nПришлю разбор, как только он будет готов.",
        track_user=False,
    )
    try:
        try:
            action, saved = await get_week_review(
                repo, user, refresh=refresh, writer=write_review_text
            )
        except Exception:
            logger.exception("Week review failed for user_id=%s", user.id)
            await answer_persistent(message, COACH_FAILED_TEXT)
            return "failed"
        if action == "refresh_spent":
            return action
        if action == "need_data":
            await answer_persistent(message, NOT_ENOUGH_TEXT)
            return action
        if action == "paywall":
            await show_subscription_screen(message, user, cleanup)
            return action
        await answer_persistent(
            message,
            saved.review_text,
            reply_markup=_keyboard_for(saved.refresh_used),
        )
        return action
    finally:
        try:
            await status.delete()
        except TelegramAPIError:
            logger.debug("Could not remove week review loading message", exc_info=True)


@router.message(Command("ai", "week"))
async def show_week(
    message: Message,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    await state.clear()
    if message.from_user is None:
        return
    repo = UserRepository(session)
    user = await repo.get_or_create_user(
        message.from_user.id, settings.default_timezone
    )
    if not week_review_allowed(user):
        await show_subscription_screen(message, user, cleanup)
        return
    await answer_persistent(message, WEEK_MENU_TEXT, reply_markup=week_menu_keyboard())


@router.callback_query(F.data == "coach:habits")
async def show_week_habits(
    callback: CallbackQuery,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    await state.clear()
    if callback.message is None or callback.from_user is None:
        await callback.answer()
        return
    await callback.answer()
    await _open_week(
        callback.message,
        session,
        cleanup,
        telegram_id=callback.from_user.id,
        refresh=False,
    )


@router.callback_query(F.data == "coach:activity")
async def show_week_activity(
    callback: CallbackQuery,
    state: FSMContext,
    session,
) -> None:
    await state.clear()
    if callback.message is None or callback.from_user is None:
        await callback.answer()
        return
    repo = UserRepository(session)
    user = await repo.get_or_create_user(
        callback.from_user.id, settings.default_timezone
    )
    if not week_review_allowed(user):
        await callback.answer()
        await callback.message.answer(
            format_subscription_status(user),
            reply_markup=subscription_keyboard(is_active=False),
        )
        return
    await callback.answer()
    local_now = local_now_for_timezone(user.timezone, datetime.now(timezone.utc))
    start, end = rolling_week(local_now.date())
    entries = await repo.get_entries_for_period(user.id, start, end)
    await answer_persistent(
        callback.message,
        format_activity_report(entries, start=start, end=end),
    )


@router.callback_query(F.data == "coach:refresh")
async def refresh_week(
    callback: CallbackQuery,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    await state.clear()
    if callback.message is None or callback.from_user is None:
        await callback.answer()
        return

    repo = UserRepository(session)
    user = await repo.get_or_create_user(
        callback.from_user.id, settings.default_timezone
    )
    if not week_review_allowed(user):
        await callback.answer()
        await callback.message.answer(
            format_subscription_status(user),
            reply_markup=subscription_keyboard(is_active=False),
        )
        return

    await callback.answer()
    action = await _open_week(
        callback.message,
        session,
        cleanup,
        telegram_id=callback.from_user.id,
        refresh=True,
    )
    if action == "refresh_spent":
        await answer_persistent(callback.message, REFRESH_SPENT_TEXT)
        return
    if action == "failed":
        return
    if action == "refresh":
        try:
            await callback.message.edit_reply_markup(reply_markup=None)
        except TelegramBadRequest:
            pass


# Retired buttons can remain in previously sent Telegram messages.
@router.callback_query(
    (F.data == "coach:pp")
    | F.data.startswith("pp_favorite:")
    | F.data.startswith("pp_favorited:")
)
async def retired_catalog_button(callback: CallbackQuery) -> None:
    await callback.answer(
        "Этот раздел больше недоступен. Откройте /ai для актуального меню.",
        show_alert=True,
    )
    if callback.message is not None:
        try:
            await callback.message.edit_reply_markup(
                reply_markup=week_menu_keyboard()
                if callback.data == "coach:pp"
                else None,
            )
        except TelegramAPIError:
            pass
