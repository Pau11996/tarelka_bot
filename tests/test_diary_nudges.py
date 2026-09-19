from __future__ import annotations

from datetime import date, datetime, time
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo

import pytest

from src.bot.services.diary_nudges import (
    EVENING_NUDGE_TEXT,
    KIND_EVENING,
    KIND_REVIVE,
    REVIVE_NUDGE_TEXT,
    choose_diary_nudge,
    format_evening_nudge,
    format_revive_nudge,
    process_diary_nudge_candidates,
)
from src.db.models import User

MOSCOW = ZoneInfo("Europe/Moscow")
MONDAY = date(2026, 9, 14)
TUESDAY = date(2026, 9, 15)
WEDNESDAY = date(2026, 9, 16)
THURSDAY = date(2026, 9, 17)


def _local(day: date, hour: int) -> datetime:
    return datetime.combine(day, time(hour=hour), tzinfo=MOSCOW)


def test_evening_eligible_when_last_entry_was_yesterday_after_20() -> None:
    decision = choose_diary_nudge(
        notifications_enabled=True,
        last_entry_date=MONDAY,
        local_now=_local(TUESDAY, 20),
    )
    assert decision is not None
    assert decision.kind == KIND_EVENING
    assert decision.last_entry_date == MONDAY
    assert decision.local_date == TUESDAY


def test_evening_not_sent_before_20() -> None:
    assert (
        choose_diary_nudge(
            notifications_enabled=True,
            last_entry_date=MONDAY,
            local_now=_local(TUESDAY, 19),
        )
        is None
    )


def test_no_evening_if_logged_today() -> None:
    assert (
        choose_diary_nudge(
            notifications_enabled=True,
            last_entry_date=TUESDAY,
            local_now=_local(TUESDAY, 21),
        )
        is None
    )


def test_no_nudge_without_entries() -> None:
    assert (
        choose_diary_nudge(
            notifications_enabled=True,
            last_entry_date=None,
            local_now=_local(TUESDAY, 21),
        )
        is None
    )


def test_opt_out_blocks_nudges() -> None:
    assert (
        choose_diary_nudge(
            notifications_enabled=False,
            last_entry_date=MONDAY,
            local_now=_local(TUESDAY, 21),
        )
        is None
    )
    assert (
        choose_diary_nudge(
            notifications_enabled=False,
            last_entry_date=MONDAY,
            local_now=_local(THURSDAY, 12),
        )
        is None
    )


def test_evening_not_sent_twice_for_same_gap() -> None:
    assert (
        choose_diary_nudge(
            notifications_enabled=True,
            last_entry_date=MONDAY,
            local_now=_local(TUESDAY, 21),
            already_sent_kinds={KIND_EVENING},
        )
        is None
    )


def test_no_nudge_on_second_empty_day() -> None:
    assert (
        choose_diary_nudge(
            notifications_enabled=True,
            last_entry_date=MONDAY,
            local_now=_local(WEDNESDAY, 21),
        )
        is None
    )


def test_revive_on_third_day_without_entry() -> None:
    decision = choose_diary_nudge(
        notifications_enabled=True,
        last_entry_date=MONDAY,
        local_now=_local(THURSDAY, 10),
    )
    assert decision is not None
    assert decision.kind == KIND_REVIVE
    assert decision.last_entry_date == MONDAY
    assert decision.local_date == THURSDAY


def test_revive_not_on_fourth_day() -> None:
    assert (
        choose_diary_nudge(
            notifications_enabled=True,
            last_entry_date=MONDAY,
            local_now=_local(date(2026, 9, 18), 10),
        )
        is None
    )


def test_revive_not_same_calendar_day_as_evening() -> None:
    assert (
        choose_diary_nudge(
            notifications_enabled=True,
            last_entry_date=MONDAY,
            local_now=_local(TUESDAY, 21),
            evening_sent_on_local_date=True,
        )
        is not None
    )
    assert (
        choose_diary_nudge(
            notifications_enabled=True,
            last_entry_date=MONDAY,
            local_now=_local(THURSDAY, 10),
            evening_sent_on_local_date=True,
        )
        is None
    )


def test_revive_not_twice_for_same_gap() -> None:
    assert (
        choose_diary_nudge(
            notifications_enabled=True,
            last_entry_date=MONDAY,
            local_now=_local(THURSDAY, 10),
            already_sent_kinds={KIND_REVIVE},
        )
        is None
    )


def test_monday_thursday_cycle() -> None:
    last = MONDAY
    tuesday_evening = choose_diary_nudge(
        notifications_enabled=True,
        last_entry_date=last,
        local_now=_local(TUESDAY, 20),
    )
    wednesday = choose_diary_nudge(
        notifications_enabled=True,
        last_entry_date=last,
        local_now=_local(WEDNESDAY, 20),
        already_sent_kinds={KIND_EVENING},
    )
    thursday = choose_diary_nudge(
        notifications_enabled=True,
        last_entry_date=last,
        local_now=_local(THURSDAY, 9),
        already_sent_kinds={KIND_EVENING},
    )
    friday = choose_diary_nudge(
        notifications_enabled=True,
        last_entry_date=last,
        local_now=_local(date(2026, 9, 18), 9),
        already_sent_kinds={KIND_EVENING, KIND_REVIVE},
    )

    assert tuesday_evening is not None and tuesday_evening.kind == KIND_EVENING
    assert wednesday is None
    assert thursday is not None and thursday.kind == KIND_REVIVE
    assert friday is None


def test_evening_text_has_opt_out_and_optional_streak() -> None:
    assert "/notifications_off" in EVENING_NUDGE_TEXT
    assert "сгорит" not in format_evening_nudge(1)
    assert "Серия 4 дней сгорит, если сегодня не будет записи." in format_evening_nudge(4)


def test_revive_text_has_opt_out() -> None:
    text = format_revive_nudge()
    assert text == REVIVE_NUDGE_TEXT
    assert "/notifications_off" in text
    assert "уже 3 дня" in text


class FakeNudgeRepo:
    def __init__(self) -> None:
        self.claims: list[tuple[int, str, date]] = []
        self.disabled: list[int] = []
        self.entry_dates: dict[int, list[date]] = {}

    async def claim_diary_nudge(
        self,
        *,
        user_id: int,
        kind: str,
        last_entry_date: date,
        local_date: date,
        now: datetime | None = None,
    ) -> bool:
        del local_date, now
        key = (user_id, kind, last_entry_date)
        if key in self.claims:
            return False
        self.claims.append(key)
        return True

    async def get_distinct_entry_dates(self, user_id: int) -> list[date]:
        return list(self.entry_dates.get(user_id, []))

    async def set_notifications_enabled(self, user: User, enabled: bool) -> User:
        del enabled
        self.disabled.append(user.id)
        return user


class FakeBot:
    def __init__(self) -> None:
        self.messages: list[tuple[int, str]] = []

    async def send_message(self, telegram_id: int, text: str) -> None:
        self.messages.append((telegram_id, text))


@pytest.mark.asyncio
async def test_process_claims_before_send_and_skips_duplicate() -> None:
    user = User(
        id=1,
        telegram_id=100,
        timezone="Europe/Moscow",
        notifications_enabled=True,
    )
    repo = FakeNudgeRepo()
    repo.entry_dates[1] = [MONDAY, date(2026, 9, 13)]
    bot = FakeBot()
    now = _local(TUESDAY, 20)

    first = await process_diary_nudge_candidates(
        bot,  # type: ignore[arg-type]
        repo,  # type: ignore[arg-type]
        [(user, MONDAY)],
        now=now,
    )
    second = await process_diary_nudge_candidates(
        bot,  # type: ignore[arg-type]
        repo,  # type: ignore[arg-type]
        [(user, MONDAY)],
        now=now,
    )

    assert first == 1
    assert second == 0
    assert repo.claims == [(1, KIND_EVENING, MONDAY)]
    assert len(bot.messages) == 1
    assert "Серия 2 дней сгорит" in bot.messages[0][1]


@pytest.mark.asyncio
async def test_forbidden_error_disables_notifications() -> None:
    from aiogram.exceptions import TelegramForbiddenError
    from aiogram.methods import SendMessage

    user = User(
        id=7,
        telegram_id=700,
        timezone="Europe/Moscow",
        notifications_enabled=True,
    )
    repo = FakeNudgeRepo()
    repo.entry_dates[7] = [MONDAY]
    bot = AsyncMock()
    bot.send_message.side_effect = TelegramForbiddenError(
        method=SendMessage(chat_id=700, text="x"),
        message="Forbidden: bot was blocked by the user",
    )

    sent = await process_diary_nudge_candidates(
        bot,
        repo,  # type: ignore[arg-type]
        [(user, MONDAY)],
        now=_local(TUESDAY, 20),
    )

    assert sent == 0
    assert repo.claims == [(7, KIND_EVENING, MONDAY)]
    assert repo.disabled == [7]
