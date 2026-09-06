from __future__ import annotations

import base64
import csv
import hashlib
import hmac
import io
import json
import os
import secrets
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
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
    survey_invitation_reply_markup,
    telegram_bot_token,
)
from src.bot.services.links import normalize_acquisition_source
from src.bot.services.survey_texts import SURVEY_INVITATION
from src.db.models import (
    AIAnalysis,
    AnalysisType,
    DailyUserActivity,
    MarketingCampaign,
    Payment,
    Profile,
    User,
)
from src.db.repository import UserRepository
from src.db.session import get_session

DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = ""
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
    active_users: int
    analyses: int
    active_subscriptions: int
    stars: int
    estimated_ai_cost_usd: float
    estimated_ai_cost_per_active_user_usd: float | None


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
    profiles: int
    activated: int
    activated_24h: int
    with_photo: int
    photo_24h: int
    d1_users: int
    d7_users: int
    paying_users: int
    payments: int
    stars: int
    conversion_pct: float
    d1_pct: float
    d7_pct: float
    payment_conversion_pct: float
    spend_usd: float = 0.0
    reach: int = 0
    cost_per_start_usd: float | None = None
    cost_per_activation_usd: float | None = None
    cost_per_paying_user_usd: float | None = None


class MarketingCampaignRequest(BaseModel):
    label: str | None = Field(default=None, max_length=255)
    spend_usd: float = Field(default=0.0, ge=0)
    reach: int = Field(default=0, ge=0)
    notes: str | None = Field(default=None, max_length=2000)


class MarketingCampaignResponse(MarketingCampaignRequest):
    source: str


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


class SurveyLaunchRequest(BaseModel):
    audience: BroadcastAudience


class SurveyFeedbackItem(BaseModel):
    user_id: int
    app_rating: int
    photo_rating: int | None
    feedback_text: str
    created_at: datetime


class SurveyResultsResponse(BaseModel):
    total_responses: int
    avg_app_rating: float | None
    avg_photo_rating: float | None
    app_distribution: dict[str, int]
    photo_distribution: dict[str, int]
    photo_skipped: int
    recent_feedback: list[SurveyFeedbackItem]


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


def estimated_ai_cost_per_analysis() -> float:
    raw_value = os.environ.get("AI_ESTIMATED_COST_USD_PER_ANALYSIS", "0")
    try:
        return max(0.0, float(raw_value))
    except ValueError:
        return 0.0


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
    expected_password = admin_password()
    if not expected_password or expected_password == "admin":
        return False
    return secrets.compare_digest(username, admin_username()) and secrets.compare_digest(
        password,
        expected_password,
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
    active_users = await session.scalar(
        select(func.count(func.distinct(DailyUserActivity.user_id))).where(
            DailyUserActivity.activity_date >= start_day
        )
    )
    analyses_count = await session.scalar(
        select(func.count(AIAnalysis.id)).where(AIAnalysis.created_at >= start_at)
    )

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
    profile_exists = (
        select(Profile.id)
        .where(Profile.user_id == User.id)
        .correlate(User)
        .exists()
    )
    analysis_exists = (
        select(AIAnalysis.id)
        .where(
            AIAnalysis.user_id == User.id,
            AIAnalysis.analysis_type != AnalysisType.CORRECTION,
        )
        .correlate(User)
        .exists()
    )
    analysis_24h_exists = (
        select(AIAnalysis.id)
        .where(
            AIAnalysis.user_id == User.id,
            AIAnalysis.analysis_type != AnalysisType.CORRECTION,
            AIAnalysis.created_at <= User.created_at + timedelta(hours=24),
        )
        .correlate(User)
        .exists()
    )
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
    signup_day = cast(func.timezone(User.timezone, User.created_at), Date)
    d1_exists = (
        select(DailyUserActivity.id)
        .where(
            DailyUserActivity.user_id == User.id,
            DailyUserActivity.activity_date == signup_day + 1,
        )
        .correlate(User)
        .exists()
    )
    d7_exists = (
        select(DailyUserActivity.id)
        .where(
            DailyUserActivity.user_id == User.id,
            DailyUserActivity.activity_date >= signup_day + 5,
            DailyUserActivity.activity_date <= signup_day + 8,
        )
        .correlate(User)
        .exists()
    )
    source_rows = await session.execute(
        select(
            source_key,
            func.count(User.id),
            func.count(User.id).filter(profile_exists),
            func.count(User.id).filter(analysis_exists),
            func.count(User.id).filter(analysis_24h_exists),
            func.count(User.id).filter(photo_exists),
            func.count(User.id).filter(photo_24h_exists),
            func.count(User.id).filter(analysis_24h_exists, d1_exists),
            func.count(User.id).filter(analysis_24h_exists, d7_exists),
        )
        .where(User.created_at >= start_at)
        .group_by(source_key)
        .order_by(func.count(User.id).desc(), source_key.asc())
    )

    source_payment_rows = await session.execute(
        select(
            source_key,
            func.count(func.distinct(Payment.user_id)),
            func.count(Payment.id),
            func.coalesce(func.sum(Payment.stars_amount), 0),
        )
        .select_from(User)
        .join(Payment, Payment.user_id == User.id)
        .where(User.created_at >= start_at)
        .group_by(source_key)
    )
    payment_by_source = {
        str(source or DIRECT_SOURCE_LABEL): (
            int(paying_users or 0),
            int(payments or 0),
            int(stars or 0),
        )
        for source, paying_users, payments, stars in source_payment_rows.all()
    }

    campaign_rows = await session.execute(
        select(
            MarketingCampaign.source,
            MarketingCampaign.spend_usd,
            MarketingCampaign.reach,
        )
    )
    campaign_by_source = {
        str(source): (float(spend_usd or 0), int(reach or 0))
        for source, spend_usd, reach in campaign_rows.all()
    }

    def percentage(numerator: int, denominator: int) -> float:
        return round((numerator / denominator) * 100, 1) if denominator else 0.0

    sources: list[AcquisitionSourcePoint] = []
    seen_sources: set[str] = set()
    for (
        source,
        users_count,
        profiles,
        activated,
        activated_24h,
        with_photo,
        photo_24h,
        d1_users,
        d7_users,
    ) in source_rows.all():
        source_value = str(source or DIRECT_SOURCE_LABEL)
        seen_sources.add(source_value)
        users_value = int(users_count or 0)
        profiles_value = int(profiles or 0)
        activated_value = int(activated or 0)
        activated_24h_value = int(activated_24h or 0)
        with_photo_value = int(with_photo or 0)
        photo_24h_value = int(photo_24h or 0)
        d1_value = int(d1_users or 0)
        d7_value = int(d7_users or 0)
        paying_users, payments, stars = payment_by_source.get(source_value, (0, 0, 0))
        spend_usd, reach = campaign_by_source.get(source_value, (0.0, 0))
        sources.append(
            AcquisitionSourcePoint(
                source=source_value,
                users=users_value,
                profiles=profiles_value,
                activated=activated_value,
                activated_24h=activated_24h_value,
                with_photo=with_photo_value,
                photo_24h=photo_24h_value,
                d1_users=d1_value,
                d7_users=d7_value,
                paying_users=paying_users,
                payments=payments,
                stars=stars,
                conversion_pct=percentage(activated_24h_value, users_value),
                d1_pct=percentage(d1_value, activated_24h_value),
                d7_pct=percentage(d7_value, activated_24h_value),
                payment_conversion_pct=percentage(paying_users, activated_24h_value),
                spend_usd=spend_usd,
                reach=reach,
                cost_per_start_usd=(
                    round(spend_usd / users_value, 2)
                    if spend_usd > 0 and users_value > 0
                    else None
                ),
                cost_per_activation_usd=(
                    round(spend_usd / activated_24h_value, 2)
                    if spend_usd > 0 and activated_24h_value > 0
                    else None
                ),
                cost_per_paying_user_usd=(
                    round(spend_usd / paying_users, 2)
                    if spend_usd > 0 and paying_users > 0
                    else None
                ),
            )
        )

    for source_value, (spend_usd, reach) in campaign_by_source.items():
        if source_value in seen_sources:
            continue
        sources.append(
            AcquisitionSourcePoint(
                source=source_value,
                users=0,
                profiles=0,
                activated=0,
                activated_24h=0,
                with_photo=0,
                photo_24h=0,
                d1_users=0,
                d7_users=0,
                paying_users=0,
                payments=0,
                stars=0,
                conversion_pct=0.0,
                d1_pct=0.0,
                d7_pct=0.0,
                payment_conversion_pct=0.0,
                spend_usd=spend_usd,
                reach=reach,
            )
        )

    analyses_value = int(analyses_count or 0)
    active_users_value = int(active_users or 0)
    estimated_cost = round(
        analyses_value * estimated_ai_cost_per_analysis(),
        4,
    )
    return AdminStatsResponse(
        period_days=period_days,
        totals=AdminTotals(
            users=int(total_users or 0),
            active_users=active_users_value,
            analyses=analyses_value,
            active_subscriptions=int(active_subscriptions or 0),
            stars=int(total_stars or 0),
            estimated_ai_cost_usd=estimated_cost,
            estimated_ai_cost_per_active_user_usd=(
                round(estimated_cost / active_users_value, 4)
                if active_users_value > 0
                else None
            ),
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


@router.get("/stats.csv", dependencies=[Depends(require_admin)])
async def admin_stats_csv(
    session: Annotated[AsyncSession, Depends(get_session)],
    days: Annotated[int, Query(ge=1, le=MAX_STATS_DAYS)] = 30,
) -> Response:
    stats = await collect_admin_stats(session, days=days)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "source",
            "users",
            "profiles",
            "activated",
            "activated_24h",
            "d1_users",
            "d7_users",
            "paying_users",
            "payments",
            "stars",
            "activation_pct",
            "d1_pct",
            "d7_pct",
            "payment_conversion_pct",
            "spend_usd",
            "reach",
            "cost_per_start_usd",
            "cost_per_activation_usd",
            "cost_per_paying_user_usd",
        ]
    )
    for source in stats.sources:
        writer.writerow(
            [
                source.source,
                source.users,
                source.profiles,
                source.activated,
                source.activated_24h,
                source.d1_users,
                source.d7_users,
                source.paying_users,
                source.payments,
                source.stars,
                source.conversion_pct,
                source.d1_pct,
                source.d7_pct,
                source.payment_conversion_pct,
                source.spend_usd,
                source.reach,
                source.cost_per_start_usd or "",
                source.cost_per_activation_usd or "",
                source.cost_per_paying_user_usd or "",
            ]
        )
    return Response(
        content=output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="taarelka-stats-{days}d.csv"'
        },
    )


def campaign_response(campaign: MarketingCampaign) -> MarketingCampaignResponse:
    return MarketingCampaignResponse(
        source=campaign.source,
        label=campaign.label,
        spend_usd=campaign.spend_usd,
        reach=campaign.reach,
        notes=campaign.notes,
    )


@router.get(
    "/campaigns",
    response_model=list[MarketingCampaignResponse],
    dependencies=[Depends(require_admin)],
)
async def admin_campaigns(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[MarketingCampaignResponse]:
    campaigns = await UserRepository(session).list_marketing_campaigns()
    return [campaign_response(campaign) for campaign in campaigns]


@router.put(
    "/campaigns/{source}",
    response_model=MarketingCampaignResponse,
    dependencies=[Depends(require_admin)],
)
async def save_admin_campaign(
    source: str,
    request: MarketingCampaignRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MarketingCampaignResponse:
    normalized_source = normalize_acquisition_source(source)
    if normalized_source is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid campaign source",
        )
    campaign = await UserRepository(session).upsert_marketing_campaign(
        source=normalized_source,
        label=request.label.strip() if request.label else None,
        spend_usd=request.spend_usd,
        reach=request.reach,
        notes=request.notes.strip() if request.notes else None,
    )
    return campaign_response(campaign)


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


@router.post("/survey/launch", response_model=BroadcastStatus, dependencies=[Depends(require_admin)])
async def admin_survey_launch(
    request: SurveyLaunchRequest,
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

    background_tasks.add_task(
        run_broadcast,
        telegram_ids,
        SURVEY_INVITATION,
        token=token,
        reply_markup=survey_invitation_reply_markup(),
    )
    return snapshot


@router.get("/survey/results", response_model=SurveyResultsResponse, dependencies=[Depends(require_admin)])
async def admin_survey_results(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SurveyResultsResponse:
    repo = UserRepository(session)
    stats = await repo.get_survey_stats()
    feedback_rows = await repo.list_survey_feedback(limit=50)
    return SurveyResultsResponse(
        total_responses=stats["total_responses"],
        avg_app_rating=stats["avg_app_rating"],
        avg_photo_rating=stats["avg_photo_rating"],
        app_distribution={str(k): v for k, v in stats["app_distribution"].items()},
        photo_distribution={str(k): v for k, v in stats["photo_distribution"].items()},
        photo_skipped=stats["photo_skipped"],
        recent_feedback=[
            SurveyFeedbackItem(
                user_id=row.user_id,
                app_rating=row.app_rating,
                photo_rating=row.photo_rating,
                feedback_text=row.feedback_text or "",
                created_at=row.created_at,
            )
            for row in feedback_rows
        ],
    )


@router.get("/survey/export.csv", dependencies=[Depends(require_admin)])
async def admin_survey_export_csv(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    repo = UserRepository(session)
    rows = await repo.list_survey_responses()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "id",
            "user_id",
            "app_rating",
            "photo_rating",
            "feedback_text",
            "created_at",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row.id,
                row.user_id,
                row.app_rating,
                row.photo_rating if row.photo_rating is not None else "",
                row.feedback_text or "",
                row.created_at.isoformat() if row.created_at else "",
            ]
        )
    return Response(
        content=output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="survey_responses.csv"',
        },
    )
