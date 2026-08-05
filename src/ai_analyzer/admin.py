from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import Payment, User
from src.db.session import get_session

DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "admin"
DEFAULT_TOKEN_TTL_SECONDS = 12 * 60 * 60
MAX_STATS_DAYS = 365

router = APIRouter(prefix="/admin", tags=["admin"])
bearer_scheme = HTTPBearer(auto_error=False)


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class AdminLoginResponse(BaseModel):
    token: str
    expires_in: int


class AdminTotals(BaseModel):
    users: int
    active_subscriptions: int
    stars: int


class DailyUsersPoint(BaseModel):
    date: date
    users: int


class DailySubscriptionsPoint(BaseModel):
    date: date
    subscriptions: int
    stars: int


class AdminStatsResponse(BaseModel):
    period_days: int
    totals: AdminTotals
    users_chart: list[DailyUsersPoint]
    subscriptions_chart: list[DailySubscriptionsPoint]


def admin_username() -> str:
    return os.environ.get("ADMIN_USERNAME", DEFAULT_ADMIN_USERNAME)


def admin_password() -> str:
    return os.environ.get("ADMIN_PASSWORD", DEFAULT_ADMIN_PASSWORD)


def token_ttl_seconds() -> int:
    raw_value = os.environ.get("ADMIN_TOKEN_TTL_SECONDS", str(DEFAULT_TOKEN_TTL_SECONDS))
    try:
        value = int(raw_value)
    except ValueError:
        return DEFAULT_TOKEN_TTL_SECONDS
    return max(60, value)


def _token_secret() -> str:
    return os.environ.get("ADMIN_TOKEN_SECRET") or admin_password()


def _encode_payload(payload: dict[str, object]) -> str:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    return base64.urlsafe_b64encode(body).decode().rstrip("=")


def _decode_payload(encoded: str) -> dict[str, object] | None:
    padding = "=" * (-len(encoded) % 4)
    try:
        raw = base64.urlsafe_b64decode(f"{encoded}{padding}")
        payload = json.loads(raw)
    except (ValueError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _signature(encoded_payload: str) -> str:
    return hmac.new(
        _token_secret().encode(),
        encoded_payload.encode(),
        hashlib.sha256,
    ).hexdigest()


def create_admin_token(now: datetime | None = None) -> str:
    current = now or datetime.now(timezone.utc)
    expires_at = current + timedelta(seconds=token_ttl_seconds())
    payload = {
        "exp": int(expires_at.timestamp()),
        "nonce": secrets.token_urlsafe(16),
        "sub": admin_username(),
    }
    encoded_payload = _encode_payload(payload)
    return f"{encoded_payload}.{_signature(encoded_payload)}"


def verify_admin_token(token: str, now: datetime | None = None) -> bool:
    try:
        encoded_payload, signature = token.split(".", 1)
    except ValueError:
        return False

    if not hmac.compare_digest(signature, _signature(encoded_payload)):
        return False

    payload = _decode_payload(encoded_payload)
    if payload is None or payload.get("sub") != admin_username():
        return False

    expires_at = payload.get("exp")
    if not isinstance(expires_at, int):
        return False

    current = now or datetime.now(timezone.utc)
    return expires_at > int(current.timestamp())


def _check_admin_credentials(username: str, password: str) -> bool:
    return secrets.compare_digest(username, admin_username()) and secrets.compare_digest(
        password,
        admin_password(),
    )


async def require_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> None:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    if not verify_admin_token(credentials.credentials):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


def _empty_user_points(start_day: date, days: int) -> dict[date, DailyUsersPoint]:
    return {
        start_day + timedelta(days=offset): DailyUsersPoint(
            date=start_day + timedelta(days=offset),
            users=0,
        )
        for offset in range(days)
    }


def _empty_subscription_points(start_day: date, days: int) -> dict[date, DailySubscriptionsPoint]:
    return {
        start_day + timedelta(days=offset): DailySubscriptionsPoint(
            date=start_day + timedelta(days=offset),
            subscriptions=0,
            stars=0,
        )
        for offset in range(days)
    }


async def collect_admin_stats(
    session: AsyncSession,
    *,
    days: int = 30,
    now: datetime | None = None,
) -> AdminStatsResponse:
    period_days = min(max(days, 1), MAX_STATS_DAYS)
    current = now or datetime.now(timezone.utc)
    start_day = current.date() - timedelta(days=period_days - 1)
    start_at = datetime.combine(start_day, time.min, tzinfo=timezone.utc)

    total_users = await session.scalar(select(func.count(User.id)))
    active_subscriptions = await session.scalar(
        select(func.count(User.id)).where(User.subscription_until > current)
    )
    total_stars = await session.scalar(select(func.coalesce(func.sum(Payment.stars_amount), 0)))

    user_day = cast(User.created_at, Date).label("day")
    user_rows = await session.execute(
        select(user_day, func.count(User.id))
        .where(User.created_at >= start_at)
        .group_by(user_day)
        .order_by(user_day)
    )

    payment_day = cast(Payment.created_at, Date).label("day")
    payment_rows = await session.execute(
        select(
            payment_day,
            func.count(Payment.id),
            func.coalesce(func.sum(Payment.stars_amount), 0),
        )
        .where(Payment.created_at >= start_at)
        .group_by(payment_day)
        .order_by(payment_day)
    )

    users_chart = _empty_user_points(start_day, period_days)
    for row_day, users in user_rows.all():
        users_chart[row_day] = DailyUsersPoint(date=row_day, users=int(users or 0))

    subscriptions_chart = _empty_subscription_points(start_day, period_days)
    for row_day, subscriptions, stars in payment_rows.all():
        subscriptions_chart[row_day] = DailySubscriptionsPoint(
            date=row_day,
            subscriptions=int(subscriptions or 0),
            stars=int(stars or 0),
        )

    return AdminStatsResponse(
        period_days=period_days,
        totals=AdminTotals(
            users=int(total_users or 0),
            active_subscriptions=int(active_subscriptions or 0),
            stars=int(total_stars or 0),
        ),
        users_chart=list(users_chart.values()),
        subscriptions_chart=list(subscriptions_chart.values()),
    )


@router.post("/login", response_model=AdminLoginResponse)
async def admin_login(request: AdminLoginRequest) -> AdminLoginResponse:
    if not _check_admin_credentials(request.username, request.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return AdminLoginResponse(token=create_admin_token(), expires_in=token_ttl_seconds())


@router.get("/stats", response_model=AdminStatsResponse, dependencies=[Depends(require_admin)])
async def admin_stats(
    session: Annotated[AsyncSession, Depends(get_session)],
    days: Annotated[int, Query(ge=1, le=MAX_STATS_DAYS)] = 30,
) -> AdminStatsResponse:
    return await collect_admin_stats(session, days=days)
