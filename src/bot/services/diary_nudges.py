from __future__ import annotations

import asyncio
import logging
from collections.abc import Collection
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from aiogram import Bot
from aiogram.exceptions import TelegramForbiddenError

from src.bot.config import settings
from src.bot.services.nutrition import calculate_logging_streak
from src.db.models import User
from src.db.repository import UserRepository
from src.db.session import async_session_factory

logger = logging.getLogger(__name__)

KIND_EVENING = "evening"
KIND_REVIVE = "revive"
EVENING_HOUR = 20

EVENING_NUDGE_TEXT = (
    "Сегодня в дневнике ТАРЕЛКИ пока пусто.\n\n"
    "Отправьте фото, голосовое или текст — бот обновит баланс.\n\n"
    "Отключить напоминания: /notifications_off"
)

REVIVE_NUDGE_TEXT = (
    "В дневнике ТАРЕЛКИ нет записей уже 3 дня.\n\n"
    "Отправьте фото, голосовое или описание следующего приёма пищи — "
    "бот обновит дневной баланс.\n\n"
    "Отключить такие напоминания: /notifications_off"
)


@dataclass(frozen=True)
class DiaryNudgeDecision:
    kind: str
    last_entry_date: date
    local_date: date


def local_now_for_timezone(timezone_name: str | None, now: datetime) -> datetime:
    name = timezone_name or settings.default_timezone
    try:
        tz = ZoneInfo(name)
    except ZoneInfoNotFoundError:
        tz = ZoneInfo(settings.default_timezone)
    current = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    return current.astimezone(tz)


def choose_diary_nudge(
    *,
    notifications_enabled: bool,
    last_entry_date: date | None,
    local_now: datetime,
    already_sent_kinds: Collection[str] = (),
    evening_sent_on_local_date: bool = False,
    evening_hour: int = EVENING_HOUR,
) -> DiaryNudgeDecision | None:
    if not notifications_enabled or last_entry_date is None:
        return None
    local_date = local_now.date()
    days_ago = (local_date - last_entry_date).days
    sent = set(already_sent_kinds)
    if (
        days_ago == 1
        and local_now.hour >= evening_hour
        and KIND_EVENING not in sent
    ):
        return DiaryNudgeDecision(
            kind=KIND_EVENING,
            last_entry_date=last_entry_date,
            local_date=local_date,
        )
    if (
        days_ago == 3
        and KIND_REVIVE not in sent
        and not evening_sent_on_local_date
        and local_date != last_entry_date + timedelta(days=1)
    ):
        return DiaryNudgeDecision(
            kind=KIND_REVIVE,
            last_entry_date=last_entry_date,
            local_date=local_date,
        )
    return None


def format_evening_nudge(streak: int) -> str:
    text = EVENING_NUDGE_TEXT
    if streak >= 2:
        text += (
            f"\n\nСерия {streak} дней сгорит, если сегодня не будет записи."
        )
    return text


def format_revive_nudge() -> str:
    return REVIVE_NUDGE_TEXT


async def _nudge_text(
    repo: UserRepository,
    user: User,
    decision: DiaryNudgeDecision,
) -> str:
    if decision.kind == KIND_REVIVE:
        return format_revive_nudge()
    dates = await repo.get_distinct_entry_dates(user.id)
    streak = calculate_logging_streak(dates, decision.local_date)
    return format_evening_nudge(streak)


async def process_diary_nudge_candidates(
    bot: Bot,
    repo: UserRepository,
    candidates: list[tuple[User, date]],
    *,
    now: datetime,
) -> int:
    sent = 0
    for user, last_entry_date in candidates:
        local_now = local_now_for_timezone(user.timezone, now)
        decision = choose_diary_nudge(
            notifications_enabled=user.notifications_enabled,
            last_entry_date=last_entry_date,
            local_now=local_now,
        )
        if decision is None:
            continue
        claimed = await repo.claim_diary_nudge(
            user_id=user.id,
            kind=decision.kind,
            last_entry_date=decision.last_entry_date,
            local_date=decision.local_date,
            now=now,
        )
        if not claimed:
            continue
        try:
            text = await _nudge_text(repo, user, decision)
            await bot.send_message(user.telegram_id, text)
            sent += 1
        except TelegramForbiddenError:
            await repo.set_notifications_enabled(user, False)
        except Exception:
            logger.exception(
                "Failed to send diary nudge to user_id=%s kind=%s",
                user.id,
                decision.kind,
            )
        await asyncio.sleep(0.05)
    return sent


async def run_diary_nudges_iteration(
    bot: Bot,
    *,
    now: datetime | None = None,
) -> int:
    current = now or datetime.now(timezone.utc)
    async with async_session_factory() as session:
        repo = UserRepository(session)
        candidates = await repo.get_diary_nudge_candidates(now=current)
        return await process_diary_nudge_candidates(
            bot, repo, candidates, now=current
        )


async def run_diary_nudges_loop(bot: Bot) -> None:
    interval = max(60, settings.diary_nudges_interval_seconds)
    while True:
        try:
            await run_diary_nudges_iteration(bot)
        except Exception:
            logger.exception("Diary nudge loop iteration failed")
        await asyncio.sleep(interval)
