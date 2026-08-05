from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

import pytest

from src.ai_analyzer.admin import collect_admin_stats, create_admin_token, verify_admin_token


class FakeResult:
    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self._rows = rows

    def all(self) -> list[tuple[Any, ...]]:
        return self._rows


class FakeSession:
    def __init__(self) -> None:
        self._scalar_values = iter([10, 3, 450])
        self._execute_values = iter(
            [
                FakeResult(
                    [
                        (date(2026, 7, 23), 2),
                        (date(2026, 7, 25), 1),
                    ]
                ),
                FakeResult(
                    [
                        (date(2026, 7, 24), 1, 150),
                        (date(2026, 7, 25), 2, 300),
                    ]
                ),
            ]
        )

    async def scalar(self, statement: Any) -> int:
        return next(self._scalar_values)

    async def execute(self, statement: Any) -> FakeResult:
        return next(self._execute_values)


def test_admin_token_expires(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ADMIN_USERNAME", "owner")
    monkeypatch.setenv("ADMIN_PASSWORD", "secret")
    monkeypatch.setenv("ADMIN_TOKEN_TTL_SECONDS", "3600")
    now = datetime(2026, 7, 25, 12, 0, tzinfo=timezone.utc)

    token = create_admin_token(now=now)

    assert verify_admin_token(token, now=now + timedelta(minutes=30))
    assert not verify_admin_token(token, now=now + timedelta(hours=2))
    assert not verify_admin_token(f"{token}x", now=now)


@pytest.mark.asyncio
async def test_collect_admin_stats_fills_missing_days() -> None:
    stats = await collect_admin_stats(
        FakeSession(),  # type: ignore[arg-type]
        days=3,
        now=datetime(2026, 7, 25, 12, 0, tzinfo=timezone.utc),
    )

    assert stats.period_days == 3
    assert stats.totals.users == 10
    assert stats.totals.active_subscriptions == 3
    assert stats.totals.stars == 450
    assert [point.users for point in stats.users_chart] == [2, 0, 1]
    assert [point.subscriptions for point in stats.subscriptions_chart] == [0, 1, 2]
    assert [point.stars for point in stats.subscriptions_chart] == [0, 150, 300]
