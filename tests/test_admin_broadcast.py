from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest

from src.ai_analyzer.broadcast import (
    ADMIN_TELEGRAM_ID,
    BroadcastAudience,
    BroadcastState,
    classify_telegram_result,
    list_broadcast_telegram_ids,
    run_broadcast,
)


class FakeScalarsResult:
    def __init__(self, values: list[int]) -> None:
        self._values = values

    def scalars(self) -> FakeScalarsResult:
        return self

    def all(self) -> list[int]:
        return self._values


class FakeSession:
    def __init__(self, values: list[int]) -> None:
        self.values = values
        self.executed = False

    async def execute(self, statement: Any) -> FakeScalarsResult:
        self.executed = True
        return FakeScalarsResult(self.values)


@pytest.mark.asyncio
async def test_list_broadcast_ids_me_skips_database() -> None:
    session = FakeSession([1, 2, 3])

    ids = await list_broadcast_telegram_ids(session, BroadcastAudience.ME)

    assert ids == [ADMIN_TELEGRAM_ID]
    assert session.executed is False


@pytest.mark.asyncio
async def test_list_broadcast_ids_all_and_subscribers() -> None:
    session = FakeSession([11, 22])

    ids = await list_broadcast_telegram_ids(
        session,
        BroadcastAudience.ALL,
        now=datetime(2026, 8, 16, tzinfo=timezone.utc),
    )

    assert ids == [11, 22]
    assert session.executed is True


@pytest.mark.parametrize(
    ("status_code", "payload", "expected"),
    [
        (200, {"ok": True}, "sent"),
        (403, {"ok": False, "description": "Forbidden: bot was blocked by the user"}, "blocked"),
        (403, {"ok": False, "description": "Forbidden: user is deactivated"}, "blocked"),
        (400, {"ok": False, "description": "Bad Request: chat not found"}, "failed"),
    ],
)
def test_classify_telegram_result(
    status_code: int,
    payload: dict[str, object],
    expected: str,
) -> None:
    assert classify_telegram_result(status_code, payload) == expected


@pytest.mark.asyncio
async def test_run_broadcast_counts_results() -> None:
    state = BroadcastState()
    state.begin("all", 3)

    async def fake_send(client: Any, token: str, chat_id: int, text: str) -> str:
        return {1: "sent", 2: "blocked", 3: "failed"}[chat_id]

    snapshot = await run_broadcast(
        [1, 2, 3],
        "hello",
        token="token",
        state=state,
        send=fake_send,
        delay_seconds=0,
    )

    assert snapshot.status == "done"
    assert snapshot.sent == 1
    assert snapshot.blocked == 1
    assert snapshot.failed == 1
    assert snapshot.targeted == 3


@pytest.mark.asyncio
async def test_run_broadcast_empty_list_is_done() -> None:
    state = BroadcastState()
    state.begin("subscribers", 0)

    snapshot = await run_broadcast(
        [],
        "hello",
        token="token",
        state=state,
        delay_seconds=0,
    )

    assert snapshot.status == "done"
    assert snapshot.sent == 0
    assert snapshot.targeted == 0
