from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

import pytest

from src.ai_analyzer.admin import (
    _check_admin_credentials,
    collect_admin_stats,
    create_admin_token,
    verify_admin_token,
)
from src.bot.services.links import normalize_acquisition_source, parse_referral_code


class FakeResult:
    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self._rows = rows

    def all(self) -> list[tuple[Any, ...]]:
        return self._rows


class FakeSession:
    def __init__(self) -> None:
        self._scalar_values = iter([10, 3, 450, 6, 20])
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
                FakeResult(
                    [
                        ("reel15", 5, 4, 3, 2, 3, 2, 1, 1),
                        ("direct", 4, 2, 1, 1, 1, 1, 0, 0),
                        ("landing", 1, 0, 0, 0, 0, 0, 0, 0),
                    ]
                ),
                FakeResult([("reel15", 1, 1, 150)]),
                FakeResult([("reel15", 20.0, 1000)]),
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


def test_admin_login_rejects_missing_or_default_password(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    assert not _check_admin_credentials("admin", "")

    monkeypatch.setenv("ADMIN_PASSWORD", "admin")
    assert not _check_admin_credentials("admin", "admin")


@pytest.mark.asyncio
async def test_collect_admin_stats_fills_missing_days(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_ESTIMATED_COST_USD_PER_ANALYSIS", "0.02")
    stats = await collect_admin_stats(
        FakeSession(),  # type: ignore[arg-type]
        days=3,
        now=datetime(2026, 7, 25, 12, 0, tzinfo=timezone.utc),
    )

    assert stats.period_days == 3
    assert stats.totals.users == 10
    assert stats.totals.active_users == 6
    assert stats.totals.analyses == 20
    assert stats.totals.active_subscriptions == 3
    assert stats.totals.stars == 450
    assert stats.totals.estimated_ai_cost_usd == 0.4
    assert stats.totals.estimated_ai_cost_per_active_user_usd == 0.0667
    assert [point.users for point in stats.users_chart] == [2, 0, 1]
    assert [point.subscriptions for point in stats.subscriptions_chart] == [0, 1, 2]
    assert [point.stars for point in stats.subscriptions_chart] == [0, 150, 300]
    assert [point.source for point in stats.sources] == ["reel15", "direct", "landing"]
    assert stats.sources[0].users == 5
    assert stats.sources[0].profiles == 4
    assert stats.sources[0].activated == 3
    assert stats.sources[0].activated_24h == 2
    assert stats.sources[0].with_photo == 3
    assert stats.sources[0].photo_24h == 2
    assert stats.sources[0].d1_pct == 50.0
    assert stats.sources[0].d7_pct == 50.0
    assert stats.sources[0].paying_users == 1
    assert stats.sources[0].payment_conversion_pct == 50.0
    assert stats.sources[0].spend_usd == 20.0
    assert stats.sources[0].cost_per_start_usd == 4.0
    assert stats.sources[0].cost_per_activation_usd == 10.0
    assert stats.sources[0].cost_per_paying_user_usd == 20.0
    assert stats.sources[0].conversion_pct == 40.0
    assert stats.sources[1].conversion_pct == 25.0
    assert stats.sources[2].conversion_pct == 0.0


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Reel_15", "reel_15"),
        ("landing", "landing"),
        ("  TikTok-Ad  ", "tiktok-ad"),
        ("premium", None),
        ("Premium", None),
        ("ref_0123456789", "referral"),
        ("???", None),
        ("", None),
        (None, None),
        ("a" * 80, "a" * 64),
        ("Reel 15!!!", "reel15"),
    ],
)
def test_normalize_acquisition_source(raw: str | None, expected: str | None) -> None:
    assert normalize_acquisition_source(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("ref_0123456789", "0123456789"),
        ("REF_ABCDEF1234", "abcdef1234"),
        ("ref_short", None),
        ("premium", None),
        (None, None),
    ],
)
def test_parse_referral_code(raw: str | None, expected: str | None) -> None:
    assert parse_referral_code(raw) == expected
