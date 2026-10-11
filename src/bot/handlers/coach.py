from __future__ import annotations

import logging
from datetime import datetime, timezone

from aiogram import F, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from src.bot.config import settings
from src.bot.handlers.subscription import format_subscription_status, show_subscription_screen
from src.bot.keyboards.menus import coach_refresh_keyboard, subscription_keyboard
from src.bot.services.coach import (
    COACH_FAILED_TEXT,
    MIN_LOGGED_DAYS,
    NOT_ENOUGH_TEXT,
    REFRESH_SPENT_TEXT,
    calendar_week_start,
    decide_week_action,
    digest_facts,
    load_week_digest,
    week_review_allowed,
    write_review_text,
)
from src.bot.services.diary_nudges import local_now_for_timezone
from src.bot.services.messaging import answer_persistent
from src.bot.services.message_cleanup import MessageCleanupService
from src.db.models import CoachReview
from src.db.repository import UserRepository

logger = logging.getLogger(__name__)

router = Router()


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

    facts = digest_facts(digest)
    try:
        text = await write_review_text(facts)
    except Exception:
        logger.exception("Week review failed for user_id=%s", user.id)
        await answer_persistent(message, COACH_FAILED_TEXT)
        return "failed"

    saved = await repo.save_coach_review(
        user_id=user.id,
        week_start=digest.week_start,
        facts=facts,
        review_text=text,
        refresh_used=action == "refresh",
    )
    await answer_persistent(
        message,
        saved.review_text,
        reply_markup=_keyboard_for(saved.refresh_used),
    )
    return action


@router.message(Command("week"))
async def show_week(
    message: Message,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    await state.clear()
    if message.from_user is None:
        return
    await _open_week(
        message,
        session,
        cleanup,
        telegram_id=message.from_user.id,
        refresh=False,
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
    user = await repo.get_or_create_user(callback.from_user.id, settings.default_timezone)
    if not week_review_allowed(user):
        await callback.answer()
        await callback.message.answer(
            format_subscription_status(user),
            reply_markup=subscription_keyboard(is_active=False),
        )
        return

    action = await _open_week(
        callback.message,
        session,
        cleanup,
        telegram_id=callback.from_user.id,
        refresh=True,
    )
    if action == "refresh_spent":
        await callback.answer(REFRESH_SPENT_TEXT, show_alert=True)
        return
    if action == "failed":
        await callback.answer()
        return
    if action == "refresh":
        try:
            await callback.message.edit_reply_markup(reply_markup=None)
        except TelegramBadRequest:
            pass
    await callback.answer()
