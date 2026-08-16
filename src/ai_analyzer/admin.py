from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.ai_analyzer.broadcast import (
    TELEGRAM_MESSAGE_MAX_LENGTH,
    BroadcastAudience,
    BroadcastStatus,
    broadcast_state,
    list_broadcast_telegram_ids,
    run_broadcast,
    telegram_bot_token,
)
from src.db.models import AIAnalysis, AnalysisType, Payment, User
from src.db.session import get_session

DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "admin"
DEFAULT_TOKEN_TTL_SECONDS = 12 * 60 * 60
MAX_STATS_DAYS = 365
DIRECT_SOURCE_LABEL = "direct"
PHOTO_ANALYSIS_TYPES = (AnalysisType.FOOD_PHOTO, AnalysisType.ACTIVITY_PHOTO)

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


class AcquisitionSourcePoint(BaseModel):
    source: str
    users: int
    with_photo: int
    photo_24h: int
    conversion_pct: float


class AdminStatsResponse(BaseModel):
    period_days: int
    totals: AdminTotals
    users_chart: list[DailyUsersPoint]
    subscriptions_chart: list[DailySubscriptionsPoint]
    sources: list[AcquisitionSourcePoint] = []


class BroadcastRequest(BaseModel):
    text: str = Field(min_length=1, max_length=TELEGRAM_MESSAGE_MAX_LENGTH)
    audience: BroadcastAudience

    @field_validator("text")
    @classmethod
    def _strip_text(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("text is blank")
        return text


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

    source_key = func.coalesce(User.acquisition_source, DIRECT_SOURCE_LABEL).label("source")
    photo_exists = (
        select(AIAnalysis.id)
        .where(
            AIAnalysis.user_id == User.id,
            AIAnalysis.analysis_type.in_(PHOTO_ANALYSIS_TYPES),
        )
        .correlate(User)
        .exists()
    )
    photo_24h_exists = (
        select(AIAnalysis.id)
        .where(
            AIAnalysis.user_id == User.id,
            AIAnalysis.analysis_type.in_(PHOTO_ANALYSIS_TYPES),
            AIAnalysis.created_at <= User.created_at + timedelta(hours=24),
        )
        .correlate(User)
        .exists()
    )
    source_rows = await session.execute(
        select(
            source_key,
            func.count(User.id),
            func.count(User.id).filter(photo_exists),
            func.count(User.id).filter(photo_24h_exists),
        )
        .where(User.created_at >= start_at)
        .group_by(source_key)
        .order_by(func.count(User.id).desc(), source_key.asc())
    )

    sources: list[AcquisitionSourcePoint] = []
    for source, users_count, with_photo, photo_24h in source_rows.all():
        users_value = int(users_count or 0)
        with_photo_value = int(with_photo or 0)
        photo_24h_value = int(photo_24h or 0)
        conversion = round((with_photo_value / users_value) * 100, 1) if users_value else 0.0
        sources.append(
            AcquisitionSourcePoint(
                source=str(source or DIRECT_SOURCE_LABEL),
                users=users_value,
                with_photo=with_photo_value,
                photo_24h=photo_24h_value,
                conversion_pct=conversion,
            )
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
        sources=sources,
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


@router.get("/broadcast", response_model=BroadcastStatus, dependencies=[Depends(require_admin)])
async def admin_broadcast_status() -> BroadcastStatus:
    return broadcast_state.snapshot()


@router.post("/broadcast", response_model=BroadcastStatus, dependencies=[Depends(require_admin)])
async def admin_broadcast(
    request: BroadcastRequest,
    background_tasks: BackgroundTasks,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> BroadcastStatus:
    token = telegram_bot_token()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TELEGRAM_BOT_TOKEN is not configured",
        )

    async with broadcast_state.lock:
        if broadcast_state.is_running:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Broadcast is already running",
            )
        telegram_ids = await list_broadcast_telegram_ids(session, request.audience)
        snapshot = broadcast_state.begin(request.audience.value, len(telegram_ids))

    background_tasks.add_task(run_broadcast, telegram_ids, request.text, token=token)
    return snapshot
